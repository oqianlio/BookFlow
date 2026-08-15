use std::collections::HashMap;

pub struct RssArticlePreview {
    pub guid: String,
    pub title: String,
    pub link: Option<String>,
    pub content: Option<String>,
    pub published_at: Option<i64>,
}

pub struct RssFeedPreview {
    pub title: String,
    pub site_url: Option<String>,
    pub articles: Vec<RssArticlePreview>,
}

#[derive(serde::Serialize)]
pub struct RssArticlePreviewOut {
    pub guid: String,
    pub title: String,
    pub link: Option<String>,
    pub content: Option<String>,
    pub published_at: Option<i64>,
}

impl From<RssArticlePreview> for RssArticlePreviewOut {
    fn from(a: RssArticlePreview) -> Self {
        RssArticlePreviewOut {
            guid: a.guid,
            title: a.title,
            link: a.link,
            content: a.content,
            published_at: a.published_at,
        }
    }
}

/// 从 block 中提取首个 <tag ...>...</tag> 的文本（大小写不敏感，支持 CDATA 与自闭合）。
/// 返回原始文本（未解码实体）。
fn extract_tag_raw(block: &str, tag: &str) -> Option<String> {
    let lower = block.to_lowercase();
    let open = format!("<{}", tag.to_lowercase());
    let start = lower.find(&open)?;
    let after_open_lower = &lower[start + open.len()..];
    // 开标签结束：找 '>'（跳过属性）
    let open_end_in_after = after_open_lower.find('>')?;
    let open_end = start + open.len() + open_end_in_after;
    // 自闭合（<tag ... />）：内容为空
    if after_open_lower[..open_end_in_after].ends_with('/') {
        return Some(String::new());
    }
    let content_start = open_end + 1;
    let close = format!("</{}>", tag.to_lowercase());
    let content_end = lower[content_start..].find(&close)? + content_start;
    Some(block[content_start..content_end].to_string())
}

fn strip_cdata(s: &str) -> String {
    let t = s.trim();
    if t.starts_with("<![CDATA[") && t.ends_with("]]>") {
        t[9..t.len() - 3].to_string()
    } else {
        t.to_string()
    }
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn clean_text(s: &str) -> String {
    decode_entities(&strip_cdata(s)).trim().to_string()
}

/// 提取 <tag> 下某个子标签（支持 attr 版：link 的 href）
fn extract_attr(block: &str, tag: &str, attr: &str) -> Option<String> {
    let lower = block.to_lowercase();
    let open = format!("<{}", tag.to_lowercase());
    let start = lower.find(&open)?;
    let head = &block[start..];
    let head_lower = &lower[start..];
    let end = head_lower.find('>')?;
    let attrs = &head[..end];
    let attr_lower = format!("{}=", attr.to_lowercase());
    let idx = attrs.to_lowercase().find(&attr_lower)? + attr_lower.len();
    let rest = &attrs[idx..];
    let rest = rest.trim_start();
    if let Some(stripped) = rest.strip_prefix('"') {
        let qend = stripped.find('"')?;
        Some(stripped[..qend].to_string())
    } else if let Some(stripped) = rest.strip_prefix('\'') {
        let qend = stripped.find('\'')?;
        Some(stripped[..qend].to_string())
    } else {
        let space = rest.find(|c: char| c.is_whitespace() || c == '>').unwrap_or(rest.len());
        Some(rest[..space].to_string())
    }
}

/// 从 XML 中按标签切出全部块（如所有 <item>...</item>）
fn extract_blocks(xml: &str, tag: &str) -> Vec<String> {
    let lower = xml.to_lowercase();
    let open = format!("<{}", tag.to_lowercase());
    let close = format!("</{}>", tag.to_lowercase());
    let mut blocks = Vec::new();
    let mut search_from = 0;
    while let Some(start) = lower[search_from..].find(&open) {
        let abs_start = search_from + start;
        // 开标签结束
        let after_open = &lower[abs_start + open.len()..];
        let Some(open_end_rel) = after_open.find('>') else { break };
        let content_start = abs_start + open.len() + open_end_rel + 1;
        let Some(end_rel) = lower[content_start..].find(&close) else { break };
        let content_end = content_start + end_rel;
        blocks.push(xml[abs_start..content_end + close.len()].to_string());
        search_from = content_end + close.len();
    }
    blocks
}

/// RFC822 日期（RSS pubDate）：Mon, 01 Jan 2024 00:00:00 GMT → 时间戳
fn parse_rfc822(s: &str) -> Option<i64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    // ["Mon,", "01", "Jan", "2024", "00:00:00", "GMT"]
    if parts.len() < 5 { return None; }
    let day: i64 = parts[1].trim_end_matches(',').parse().ok()?;
    let month = match parts[2].to_lowercase().as_str() {
        "jan" => 1, "feb" => 2, "mar" => 3, "apr" => 4, "may" => 5, "jun" => 6,
        "jul" => 7, "aug" => 8, "sep" => 9, "oct" => 10, "nov" => 11, "dec" => 12,
        _ => return None,
    };
    let year: i64 = parts[3].parse().ok()?;
    let hm: Vec<i64> = parts.get(4).map(|t| t.split(':').filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
    let (h, m, sec) = match hm.as_slice() {
        [h, m] => (*h, *m, 0),
        [h, m, s] => (*h, *m, *s),
        _ => (0, 0, 0),
    };
    Some(civil_to_ts(year, month, day, h, m, sec))
}

/// ISO8601（Atom updated）：2024-01-01T00:00:00Z → 时间戳
fn parse_iso8601(s: &str) -> Option<i64> {
    let t = s.trim();
    let (date_part, time_part) = t.split_once('T')?;
    let dp: Vec<&str> = date_part.split('-').collect();
    if dp.len() != 3 { return None; }
    let year: i64 = dp[0].parse().ok()?;
    let month: i64 = dp[1].parse().ok()?;
    let day: i64 = dp[2].parse().ok()?;
    let tp = time_part.trim_end_matches('Z').trim_end_matches('z');
    let hm: Vec<i64> = tp.split(':').filter_map(|x| x.split('.').next().unwrap_or("").parse().ok()).collect();
    let (h, m, sec) = match hm.as_slice() {
        [h, m] => (*h, *m, 0),
        [h, m, s] => (*h, *m, *s),
        _ => (0, 0, 0),
    };
    Some(civil_to_ts(year, month, day, h, m, sec))
}

/// 简化公历→Unix 时间戳（1900-2100 有效）
fn civil_to_ts(year: i64, month: i64, day: i64, h: i64, m: i64, s: i64) -> i64 {
    let mut days = 0;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    const MDAY: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for mo in 1..month {
        days += MDAY[(mo - 1) as usize];
    }
    if month > 2 && is_leap(year) { days += 1; }
    days += day - 1;
    days * 86400 + h * 3600 + m * 60 + s
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn parse_published(raw: &str) -> Option<i64> {
    parse_rfc822(raw).or_else(|| parse_iso8601(raw))
}

/// 解析 RSS 2.0 / Atom XML
pub fn parse_rss_xml(xml: &str) -> Result<RssFeedPreview, String> {
    let xml = xml.trim();
    if !xml.starts_with('<') {
        return Err("内容不是 XML".into());
    }
    let lower = xml.to_lowercase();
    let is_atom = lower.contains("<feed") && lower.contains("<entry");
    let is_rss = lower.contains("<rss") && lower.contains("<item");
    if !is_atom && !is_rss {
        return Err("无法识别 RSS/Atom 格式".into());
    }

    if is_atom {
        let title = extract_tag_raw(xml, "title").map(|s| clean_text(&s)).unwrap_or_default();
        let site_url = extract_tag_raw(xml, "link")
            .map(|s| clean_text(&s))
            .filter(|s| !s.is_empty())
            .or_else(|| extract_attr(xml, "link", "href"))
            .map(|s| decode_entities(&s));
        let mut articles = Vec::new();
        for entry in extract_blocks(xml, "entry") {
            let title = extract_tag_raw(&entry, "title").map(|s| clean_text(&s)).unwrap_or_default();
            let guid = extract_tag_raw(&entry, "id").map(|s| clean_text(&s)).unwrap_or_default();
            let link = extract_attr(&entry, "link", "href")
                .or_else(|| extract_tag_raw(&entry, "link").map(|s| clean_text(&s)))
                .map(|s| decode_entities(&s));
            let content = extract_tag_raw(&entry, "content").map(|s| clean_text(&s));
            let published = extract_tag_raw(&entry, "updated").and_then(|s| parse_published(&s));
            if !title.is_empty() {
                articles.push(RssArticlePreview { guid, title, link, content, published_at: published });
            }
        }
        return Ok(RssFeedPreview { title, site_url, articles });
    }

    // RSS 2.0
    let channel = extract_blocks(xml, "channel").into_iter().next().unwrap_or_else(|| xml.to_string());
    let title = extract_tag_raw(&channel, "title").map(|s| clean_text(&s)).unwrap_or_default();
    let site_url = extract_tag_raw(&channel, "link").map(|s| clean_text(&s)).filter(|s| !s.is_empty());
    let mut articles = Vec::new();
    for item in extract_blocks(&channel, "item") {
        let title = extract_tag_raw(&item, "title").map(|s| clean_text(&s)).unwrap_or_default();
        let guid = extract_tag_raw(&item, "guid")
            .map(|s| clean_text(&s))
            .unwrap_or_default();
        let guid = if guid.is_empty() {
            extract_tag_raw(&item, "link").map(|s| clean_text(&s)).unwrap_or_default()
        } else { guid };
        let link = extract_tag_raw(&item, "link").map(|s| clean_text(&s)).filter(|s| !s.is_empty());
        let content = extract_tag_raw(&item, "description").map(|s| clean_text(&s));
        let published = extract_tag_raw(&item, "pubDate").and_then(|s| parse_published(&s));
        if !title.is_empty() {
            articles.push(RssArticlePreview { guid, title, link, content, published_at: published });
        }
    }
    if title.is_empty() && articles.is_empty() {
        return Err("未解析到频道内容".into());
    }
    Ok(RssFeedPreview { title, site_url, articles })
}

/// 同步抓取 RSS XML（复用 net 的 UA/超时）
pub fn http_get_xml(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(crate::net::DEFAULT_TIMEOUT_MS))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let mut headers = HashMap::new();
    headers.insert("User-Agent".to_string(), crate::net::DEFAULT_UA.to_string());
    let mut resp = crate::net::build_request(&client, "GET", url, &headers, None, None)
        .send()
        .map_err(|e| crate::net::friendly_network_error(&e, url))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut bytes = Vec::new();
    resp.copy_to(&mut bytes).map_err(|e| format!("读取响应失败: {e}"))?;
    crate::net::decode_body(&bytes, None)
}

/// 从远程书源合集文本中提取第一个书源的名称（用于订阅显示名）
pub fn extract_first_source_name(text: &str) -> Option<String> {
    let obj: serde_json::Value = serde_json::from_str(text).ok()?;
    let arr = if obj.is_array() { obj.as_array()? } else { std::slice::from_ref(&obj) };
    arr.iter().find_map(|v| {
        v.get("bookSourceName").and_then(|n| n.as_str()).map(|s| s.to_string())
    })
}
