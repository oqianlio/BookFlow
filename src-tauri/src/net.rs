use std::collections::HashMap;

pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;
pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub fn decode_body(bytes: &[u8], _charset_hint: Option<&str>) -> Result<String, String> {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }
    // GBK 优先，其次 latin1 兜底（保证不崩溃）
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    Ok(cow.into_owned())
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
    let cookies = state.cookies.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let jar = cookie_jar.map(|key| cookies.jar_for(&key));
        let mut client_builder = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)));
        if let Some(j) = &jar {
            client_builder = client_builder.cookie_provider(j.clone());
        }
        let client = client_builder
            .build()
            .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
        let empty = HashMap::new();
        let h = headers.as_ref().unwrap_or(&empty);
        let req = build_request(
            &client,
            method.as_deref().unwrap_or("GET"),
            &url,
            h,
            body.as_deref(),
            content_type.as_deref(),
        );
        let mut resp = req.send().map_err(|e| format!("网络请求失败: {e}"))?;
        // reqwest 只在内存中读写 cookie，不会自动写回文件，需手动持久化
        if let Some(j) = &jar {
            j.save();
        }
        eprintln!("[net] request took {}ms url={}", t0.elapsed().as_millis(), &url[..url.len().min(80)]);
        // 手动读取原始字节而非 resp.bytes()/text()：
        // reqwest 0.13 在无 gzip feature 时对部分 chunked 响应会报 "error decoding response body"，
        // 而原始字节是有效的（copy_to 可正常读出）。绕过后交由 decode_body 处理。
        let mut bytes = Vec::new();
        resp.copy_to(&mut bytes)
            .map_err(|e| format!("读取响应失败: {e}"))?;
        decode_body(&bytes, None)
    })
    .await
    .map_err(|e| format!("网络任务调度失败: {e}"))?
}
