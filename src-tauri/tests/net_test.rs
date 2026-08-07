use yd_lib::net::decode_body;

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
