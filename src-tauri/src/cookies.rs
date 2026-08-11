use reqwest::header::HeaderValue;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// 清洗书源域名/标识为安全文件名：`|` `/` `\` `:` → `_`
pub fn sanitize_key(key: &str) -> String {
    key.chars()
        .map(|c| if c == '|' || c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect()
}

/// 单个书源对应的 cookie 容器：内存持有 `cookie_store::CookieStore`，
/// 与 `<dir>/<sanitized key>.json` 文件绑定，实现 reqwest 的 `CookieStore` trait
/// 以注入 http_get 客户端。reqwest 仅在内存中读写 cookie，不自动写回文件，
/// 因此请求结束后需显式调用 [`save`](CookieJar::save) 持久化。
pub struct CookieJar {
    file: PathBuf,
    store: RwLock<cookie_store::CookieStore>,
}

impl CookieJar {
    fn load(file: PathBuf) -> Self {
        let store = std::fs::File::open(&file)
            .ok()
            .and_then(|f| cookie_store::serde::json::load(std::io::BufReader::new(f)).ok())
            .unwrap_or_default();
        Self {
            file,
            store: RwLock::new(store),
        }
    }

    /// 将内存中的 cookie（含 session cookie）写回 `<dir>/<sanitized key>.json`。
    pub fn save(&self) {
        let store = match self.store.read() {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Ok(file) = std::fs::File::create(&self.file) {
            let mut writer = BufWriter::new(file);
            let _ = cookie_store::serde::json::save_incl_expired_and_nonpersistent(
                &store,
                &mut writer,
            );
        }
    }
}

impl reqwest::cookie::CookieStore for CookieJar {
    fn set_cookies(&self, cookie_headers: &mut dyn Iterator<Item = &HeaderValue>, url: &reqwest::Url) {
        let iter = cookie_headers.filter_map(|val| {
            val.to_str()
                .ok()
                .and_then(|s| cookie_store::RawCookie::parse(s).ok())
                .map(|c| c.into_owned())
        });
        if let Ok(mut store) = self.store.write() {
            store.store_response_cookies(iter, url);
        }
    }

    fn cookies(&self, url: &reqwest::Url) -> Option<HeaderValue> {
        let store = self.store.read().ok()?;
        let s = store
            .get_request_values(url)
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ");
        if s.is_empty() {
            None
        } else {
            HeaderValue::from_str(&s).ok()
        }
    }
}

/// 按书源 key 管理 cookie jar 文件：`<dir>/<sanitized key>.json`。
#[derive(Clone)]
pub struct CookieJarManager {
    dir: PathBuf,
}

impl CookieJarManager {
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();
        Self { dir }
    }

    /// 返回该 key 的 jar：从 `<dir>/<sanitized>.json` 加载，文件不存在则新建空 jar。
    pub fn jar_for(&self, key: &str) -> Arc<CookieJar> {
        let file = self.dir.join(format!("{}.json", sanitize_key(key)));
        Arc::new(CookieJar::load(file))
    }
}
