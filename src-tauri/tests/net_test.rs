use std::collections::HashMap;

use yd_lib::net::{build_request, decode_body, url_host, DEFAULT_UA};

#[test]
fn extracts_host_from_url() {
    assert_eq!(url_host("https://www.101kanshu.net/novels/class/1.html"), "www.101kanshu.net");
    assert_eq!(url_host("http://ex.com/a?x=1"), "ex.com");
    assert_eq!(url_host("not-a-url"), "");
}

#[test]
fn connect_error_gets_friendly_message() {
    // 对不可达域名发起真实请求，验证错误消息被翻译成友好中文
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(8000))
        .build()
        .unwrap();
    let url = "https://this-domain-should-not-exist-12345.invalid/";
    let err = client.get(url).send().unwrap_err();
    let msg = yd_lib::net::friendly_network_error(&err, url);
    assert!(msg.contains("无法连接到站点") || msg.contains("网络请求失败"), "got: {msg}");
    assert!(msg.contains("this-domain-should-not-exist-12345.invalid"));
}

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
