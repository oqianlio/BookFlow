use yd_lib::rss::parse_rss_xml;

const RSS2: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>测试频道</title><link>https://ex.com</link>
  <item><title>文章一</title><link>https://ex.com/a1</link><guid>g1</guid><description><![CDATA[<p>正文一</p>]]></description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  <item><title>文章二</title><link>https://ex.com/a2</link><guid>g2</guid><description>纯文本二</description></item>
</channel></rss>"#;

const ATOM: &str = r#"<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 频道</title>
  <entry><title>条目一</title><id>tag:ex,2024:1</id><link href="https://ex.com/e1"/><content type="html"><p>内容一</p></content><updated>2024-01-01T00:00:00Z</updated></entry>
</feed>"#;

#[test]
fn parses_rss20_feed() {
    let f = parse_rss_xml(RSS2).unwrap();
    assert_eq!(f.title, "测试频道");
    assert_eq!(f.site_url.as_deref(), Some("https://ex.com"));
    assert_eq!(f.articles.len(), 2);
    assert_eq!(f.articles[0].title, "文章一");
    assert_eq!(f.articles[0].guid, "g1");
    assert!(f.articles[0].content.as_deref().unwrap().contains("正文一"));
    assert_eq!(f.articles[1].title, "文章二");
    assert_eq!(f.articles[1].guid, "g2");
}

#[test]
fn parses_atom_feed() {
    let f = parse_rss_xml(ATOM).unwrap();
    assert_eq!(f.title, "Atom 频道");
    assert_eq!(f.articles.len(), 1);
    assert_eq!(f.articles[0].title, "条目一");
    assert_eq!(f.articles[0].guid, "tag:ex,2024:1");
    assert!(f.articles[0].content.as_deref().unwrap().contains("内容一"));
    assert!(f.articles[0].published_at.is_some());
}

#[test]
fn rejects_non_xml() {
    assert!(parse_rss_xml("not xml at all").is_err());
}
