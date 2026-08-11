use reqwest::cookie::CookieStore;
use reqwest::header::HeaderValue;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;
use yd_lib::cookies::{CookieJarManager, sanitize_key};

#[test]
fn sanitizes_key_for_filename() {
    assert_eq!(sanitize_key("https://www.example.com/"), "https___www.example.com_");
    assert_eq!(sanitize_key("a|b\\c:d"), "a_b_c_d");
}

#[test]
fn jar_for_roundtrips_persistence() {
    let dir = tempdir().unwrap();
    let mgr = CookieJarManager::new(dir.path().to_path_buf());
    // jar 首次创建为空，不崩溃
    let jar = mgr.jar_for("example.com");
    drop(jar);
    // 再次获取同 key 不崩溃
    let _ = mgr.jar_for("example.com");
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn jar_for_returns_same_arc_for_same_key() {
    let dir = tempdir().unwrap();
    let mgr = CookieJarManager::new(dir.path().to_path_buf());
    let a = mgr.jar_for("example.com");
    let b = mgr.jar_for("example.com");
    assert!(Arc::ptr_eq(&a, &b), "同一 key 的重复调用应返回同一 Arc<CookieJar>");
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn cookie_survives_disk_roundtrip() {
    let dir = tempdir().unwrap();
    let mgr = CookieJarManager::new(dir.path().to_path_buf());
    let url = reqwest::Url::parse("https://example.com/").unwrap();

    let jar = mgr.jar_for("example.com");
    let set_cookie = HeaderValue::from_str("session=abc123; Path=/").unwrap();
    let mut headers = std::iter::once(&set_cookie);
    jar.set_cookies(&mut headers, &url);
    assert!(
        jar.cookies(&url).is_some(),
        "注入内存的 cookie 应可立即读取"
    );
    jar.save();
    drop(jar);

    // 新 manager 重新从磁盘加载，session cookie（无 Expires）也应被持久化
    let mgr2 = CookieJarManager::new(dir.path().to_path_buf());
    let jar2 = mgr2.jar_for("example.com");
    let got = jar2.cookies(&url).expect("重新加载后 cookie 应存在");
    let got = got.to_str().unwrap();
    assert!(
        got.contains("session=abc123"),
        "实际 cookie: {got}"
    );
    fs::remove_dir_all(dir.path()).unwrap();
}
