use std::collections::HashMap;

use yd_lib::net::{build_request, decode_body, DEFAULT_UA};

#[test]
fn decodes_utf8() {
    let html = "你好世界".as_bytes().to_vec();
    assert_eq!(decode_body(&html, None).unwrap(), "你好世界");
}

#[test]
fn decodes_gbk() {
    // "测试" 的 GBK 编码字节
    let gbk = [0xB2, 0xE2, 0xCA, 0xD4];
    assert_eq!(decode_body(&gbk, None).unwrap(), "测试");
}

#[test]
fn injects_default_ua_when_absent() {
    let client = reqwest::blocking::Client::new();
    let req = build_request(&client, "GET", "http://example.com", &HashMap::new(), None, None)
        .build()
        .unwrap();
    let ua = req.headers().get(reqwest::header::USER_AGENT).unwrap().to_str().unwrap();
    assert_eq!(ua, DEFAULT_UA);
}

#[test]
fn respects_source_ua() {
    let client = reqwest::blocking::Client::new();
    let mut h = HashMap::new();
    h.insert("User-Agent".into(), "MyCustomUA/1.0".into());
    let req = build_request(&client, "GET", "http://example.com", &h, None, None).build().unwrap();
    let ua = req.headers().get(reqwest::header::USER_AGENT).unwrap().to_str().unwrap();
    assert_eq!(ua, "MyCustomUA/1.0");
}

#[test]
fn post_with_body_and_content_type() {
    let client = reqwest::blocking::Client::new();
    let mut h = HashMap::new();
    h.insert("User-Agent".into(), DEFAULT_UA.into());
    let req = build_request(
        &client,
        "POST",
        "http://example.com/search",
        &h,
        Some("q=x"),
        Some("application/x-www-form-urlencoded"),
    )
    .build()
    .unwrap();
    assert_eq!(req.method(), reqwest::Method::POST);
    let ct = req.headers().get(reqwest::header::CONTENT_TYPE).unwrap().to_str().unwrap();
    assert_eq!(ct, "application/x-www-form-urlencoded");
}
