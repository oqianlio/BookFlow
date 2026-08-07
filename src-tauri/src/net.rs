use std::collections::HashMap;

pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;

/// 请求选项，供规则引擎按需扩展。
pub struct HttpGetOptions {
    pub headers: HashMap<String, String>,
    pub timeout_ms: Option<u64>,
}

pub fn decode_body(bytes: &[u8], _charset_hint: Option<&str>) -> Result<String, String> {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }
    // GBK 优先，其次 latin1 兜底（保证不崩溃）
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    Ok(cow.into_owned())
}

#[tauri::command]
pub fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let mut req = client.get(&url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(&k, &v);
        }
    }
    let resp = req.send().map_err(|e| format!("网络请求失败: {e}"))?;
    let bytes = resp.bytes().map_err(|e| format!("读取响应失败: {e}"))?;
    decode_body(&bytes, None)
}
