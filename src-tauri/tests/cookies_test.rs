use std::fs;
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
