use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;

/// 校验 path 位于 root 目录内（canonicalize 后前缀匹配），防目录穿越/任意文件读写。
/// path 必须已存在（canonicalize 需要）；写入目标不存在时由调用方先校验父目录。
pub fn ensure_within(root: &Path, path: &Path) -> Result<(), String> {
    let root_c = root.canonicalize().map_err(|e| format!("目录不可访问: {e}"))?;
    let path_c = path.canonicalize().map_err(|_| "路径不存在或不可访问".to_string())?;
    if path_c.starts_with(&root_c) {
        Ok(())
    } else {
        Err("路径不在允许的目录内".to_string())
    }
}
pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 解码响应字节：UTF-16（BOM 检测）→ UTF-8 → GBK 兜底（保证不崩溃）
pub fn decode_body(bytes: &[u8], _charset_hint: Option<&str>) -> Result<String, String> {
    if bytes.len() >= 2 {
        if bytes[0] == 0xFF && bytes[1] == 0xFE {
            return Ok(String::from_utf16_lossy(&utf16_units(bytes, false)));
        }
        if bytes[0] == 0xFE && bytes[1] == 0xFF {
            return Ok(String::from_utf16_lossy(&utf16_units(bytes, true)));
        }
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }
    // GBK 优先，其次 latin1 兜底（保证不崩溃）
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    Ok(cow.into_owned())
}

/// 跳过 BOM 后按 2 字节切分 u16 码元
fn utf16_units(bytes: &[u8], big_endian: bool) -> Vec<u16> {
    bytes[2..]
        .chunks_exact(2)
        .map(|c| {
            if big_endian {
                u16::from_be_bytes([c[0], c[1]])
            } else {
                u16::from_le_bytes([c[0], c[1]])
            }
        })
        .collect()
}

/// 从 URL 提取 host（供错误提示与测试）
pub fn url_host(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split(['/', '?']).next())
        .unwrap_or("")
        .to_string()
}

/// 把 reqwest 底层网络错误翻译成可操作的友好中文提示（区分 DNS/连接/超时）。
pub fn friendly_network_error(e: &reqwest::Error, url: &str) -> String {
    let host = url_host(url);
    if e.is_timeout() {
        format!("请求超时，站点响应过慢：{host}")
    } else if e.is_connect() {
        format!("无法连接到站点，可能网络不通或站点已失效：{host}")
    } else if e.is_builder() {
        format!("请求构建失败：{host}")
    } else {
        // DNS 解析失败、TLS 等：给出站点可能失效的提示
        format!("网络请求失败（{host} 无法访问，可能域名已失效或需要网络代理）：{e}")
    }
}

/// 构造请求：书源 header 优先，未声明 UA 时注入默认浏览器 UA；POST 支持 form-urlencoded。
pub fn build_request(
    client: &reqwest::blocking::Client,
    method: &str,
    url: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
    content_type: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let mut req = if method.eq_ignore_ascii_case("POST") {
        let ct = content_type.unwrap_or("application/x-www-form-urlencoded");
        client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, ct)
            .body(body.unwrap_or("").to_string())
    } else {
        client.get(url)
    };
    let mut has_ua = false;
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("user-agent") {
            has_ua = true;
        }
        req = req.header(k, v);
    }
    if !has_ua {
        req = req.header(reqwest::header::USER_AGENT, DEFAULT_UA);
    }
    req
}

#[tauri::command]
pub async fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
    cookie_jar: Option<String>,
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<String, String> {
    // 空/空白 URL 直接拒绝：避免 reqwest builder 错误（"请求构建失败"）与无效请求
    if url.trim().is_empty() {
        crate::logs::rust_log(&state.app_data_dir, "error", "[net] 拒绝空 URL 请求（规则提取为空，调用方应回退）");
        return Err("请求地址为空（书源规则提取失败）".to_string());
    }
    let cookies = state.cookies.clone();
    let http_clients = state.http_clients.clone();
    let app_data_dir = state.app_data_dir.clone();
    let method_display = method.clone().unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let short_url = |u: &str| {
        if u.len() <= 100 { u.to_string() } else { format!("{}…({}B)", &u[..100], u.len()) }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let client_key = cookie_jar.clone().unwrap_or_default();
        let jar = cookie_jar.map(|key| cookies.jar_for(&key));
        // 按 jar key（host）复用 client，保留 keep-alive/连接池；无 jar 请求共享同一 client
        let client = {
            let mut map = http_clients
                .lock()
                .map_err(|_| "HTTP 客户端池锁失效".to_string())?;
            if let Some(c) = map.get(&client_key) {
                c.clone()
            } else {
                let mut builder = reqwest::blocking::Client::builder()
                    // 连接超时单独设短（死链快速失败）；总超时放宽（慢站点给足响应时间）
                    .connect_timeout(std::time::Duration::from_millis(DEFAULT_CONNECT_TIMEOUT_MS))
                    .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)));
                if let Some(j) = &jar {
                    builder = builder.cookie_provider(j.clone());
                }
                let c = Arc::new(
                    builder
                        .build()
                        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?,
                );
                map.insert(client_key.clone(), c.clone());
                c
            }
        };
        let empty = HashMap::new();
        let h = headers.as_ref().unwrap_or(&empty);
        let req = build_request(
            &client,
            &method_display,
            &url,
            h,
            body.as_deref(),
            content_type.as_deref(),
        );
        let mut resp = req.send().map_err(|e| {
            let msg = friendly_network_error(&e, &url);
            crate::logs::rust_log(
                &app_data_dir,
                "error",
                &format!("[net] {method_display} {} ERROR {} ({}ms)", short_url(&url), msg, t0.elapsed().as_millis()),
            );
            msg
        })?;
        // reqwest 只在内存中读写 cookie，不会自动写回文件，需手动持久化
        if let Some(j) = &jar {
            j.save();
        }
        let status = resp.status().as_u16();
        let elapsed_ms = t0.elapsed().as_millis();
        eprintln!("[net] request took {}ms url={}", elapsed_ms, &url[..url.len().min(80)]);
        // 手动读取原始字节而非 resp.bytes()/text()：
        // reqwest 0.13 在无 gzip feature 时对部分 chunked 响应会报 "error decoding response body"，
        // 而原始字节是有效的（copy_to 可正常读出）。绕过后交由 decode_body 处理。
        let mut bytes = Vec::new();
        resp.copy_to(&mut bytes)
            .map_err(|e| format!("读取响应失败: {e}"))?;
        crate::logs::rust_log(
            &app_data_dir,
            "info",
            &format!("[net] {method_display} {} {} {}ms {}B", short_url(&url), status, elapsed_ms, bytes.len()),
        );
        decode_body(&bytes, None)
    })
    .await
    .map_err(|e| format!("网络任务调度失败: {e}"))?
}
