use crate::db::{list_books, Book};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, TantivyDocument};
use tantivy::tokenizer::{NgramTokenizer, TokenizerManager};
use tantivy::{doc, Index};

/// 中文检索：注册 2-gram 分词器（tantivy 默认分词器不切分中文）
fn tokenizers() -> TokenizerManager {
    let manager = TokenizerManager::default();
    manager.register(
        "cjk",
        NgramTokenizer::new(2, 2, false).expect("bigram tokenizer"),
    );
    manager
}

/// 命中片段半径（字符数）
const SNIPPET_RADIUS: usize = 60;

/// 索引 schema 版本：变更 schema 后递增，搜索时若版本不符自动重建
const SCHEMA_VERSION: &str = "2";

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchHit {
    pub book_id: u64,
    pub title: String,
    pub format: String,
    /// 命中片段（已在 Rust 侧截断，避免整本书文本经 IPC 传输）
    pub text: String,
    /// 定位信息：EPUB 为 spine 章节 href；PDF 为页码；MD/TXT 为行号（见前端按格式解析）
    pub location: String,
}

struct Fields {
    id: Field,
    title: Field,
    text: Field,
    location: Field,
    format: Field,
}

fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    // book_id 用字符串存储并建立索引（raw 分词），便于按 term 精准删除
    let id_indexing = TextFieldIndexing::default()
        .set_tokenizer("raw")
        .set_index_option(IndexRecordOption::Basic);
    let id = b.add_text_field(
        "book_id",
        TextOptions::default()
            .set_stored()
            .set_indexing_options(id_indexing),
    );
    let text_opts = TextOptions::default()
        .set_stored()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("cjk")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        );
    let title = b.add_text_field("title", text_opts.clone());
    let text = b.add_text_field("text", text_opts);
    let location = b.add_text_field("location", TextOptions::default().set_stored());
    let format = b.add_text_field("format", TextOptions::default().set_stored());
    (
        b.build(),
        Fields { id, title, text, location, format },
    )
}

/// 切分书籍正文为（文本，定位信息）的若干节：每种格式一节一索引文档。
/// - TXT/MD：按固定行数分块，定位为节首行号
/// - EPUB：按 spine 章节分块，定位为章节 href
/// - PDF：按页分块，定位为页码
fn extract_sections(format: &str, path: &Path) -> Vec<(String, String)> {
    match format {
        "md" | "txt" => extract_text_sections(path),
        "epub" => extract_epub_sections(path),
        "pdf" => extract_pdf_sections(path),
        _ => Vec::new(),
    }
}

/// TXT/MD：每块最多 LINE_CHUNK 行，定位为块首行号（0 基）
const LINE_CHUNK: usize = 100;

fn extract_text_sections(path: &Path) -> Vec<(String, String)> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out = Vec::new();
    for (i, chunk) in lines.chunks(LINE_CHUNK).enumerate() {
        let mut s = chunk.join("\n");
        if s.ends_with('\n') {
            s.pop();
        }
        if !s.trim().is_empty() {
            // 行号带 line: 前缀，与书签/进度的页码/百分比定位区分
            out.push((s, format!("line:{}", i * LINE_CHUNK)));
        }
    }
    out
}

fn extract_epub_sections(path: &Path) -> Vec<(String, String)> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    // 优先按 spine 顺序提取（定位为章节 href，epub.js 可直接跳转）
    let spine = parse_epub_spine(&mut archive);
    if spine.is_empty() {
        // 兜底：按压缩包内顺序遍历 HTML 文件
        for i in 0..archive.len() {
            let mut f = match archive.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let name = f.name().to_lowercase();
            if name.ends_with(".html") || name.ends_with(".xhtml") || name.ends_with(".htm") {
                let mut s = String::new();
                if f.read_to_string(&mut s).is_ok() {
                    let t = strip_html(&s);
                    if !t.trim().is_empty() {
                        out.push((t, f.name().to_string()));
                    }
                }
            }
        }
        return out;
    }
    for (href, archive_path) in spine {
        let mut s = String::new();
        if let Ok(mut f) = archive.by_name(&archive_path) {
            if f.read_to_string(&mut s).is_ok() {
                let t = strip_html(&s);
                if !t.trim().is_empty() {
                    out.push((t, href));
                }
            }
        }
    }
    out
}

fn parse_epub_spine(archive: &mut zip::ZipArchive<File>) -> Vec<(String, String)> {
    let container = match read_entry(archive, "META-INF/container.xml") {
        Some(c) => c,
        None => return Vec::new(),
    };
    let opf = match attr(&container, "full-path") {
        Some(o) if !o.is_empty() => o,
        _ => return Vec::new(),
    };
    let opf_xml = match read_entry(archive, &opf) {
        Some(x) => x,
        None => return Vec::new(),
    };
    let manifest = match between(&opf_xml, "<manifest", "</manifest>") {
        Some(m) => m,
        None => return Vec::new(),
    };
    let mut href_by_id: HashMap<String, String> = HashMap::new();
    let mut rest = manifest;
    while let Some(i) = rest.find("<item") {
        let after = &rest[i..];
        let end = match after.find('>') {
            Some(e) => e,
            None => break,
        };
        let tag = &after[..end];
        if let (Some(id), Some(href)) = (attr(tag, "id"), attr(tag, "href")) {
            href_by_id.insert(id, href);
        }
        rest = &after[end..];
    }
    let spine_block = match between(&opf_xml, "<spine", "</spine>") {
        Some(s) => s,
        None => return Vec::new(),
    };
    let opf_dir = parent_dir(&opf);
    let mut out = Vec::new();
    let mut rest = spine_block;
    while let Some(i) = rest.find("<itemref") {
        let after = &rest[i..];
        let end = match after.find('>') {
            Some(e) => e,
            None => break,
        };
        let tag = &after[..end];
        if let Some(idref) = attr(tag, "idref") {
            if let Some(href) = href_by_id.get(&idref) {
                let archive_path = resolve_relative_path(&opf_dir, href);
                out.push((href.clone(), archive_path));
            }
        }
        rest = &after[end..];
    }
    out
}

fn extract_pdf_sections(path: &Path) -> Vec<(String, String)> {
    match pdf_extract::extract_text_by_pages(path) {
        Ok(pages) => pages
            .into_iter()
            .enumerate()
            .filter(|(_, t)| !t.trim().is_empty())
            .map(|(i, t)| (t, (i + 1).to_string()))
            .collect(),
        Err(e) => {
            eprintln!("PDF 文本提取失败，PDF 搜索暂不可用: {e}");
            Vec::new()
        }
    }
}

fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// 锁内轻量：读取全部书籍元数据（重活放 build_index_from_books）
pub fn collect_books(conn: &Connection) -> Result<Vec<Book>, String> {
    list_books(conn).map_err(|e| e.to_string())
}

/// 从书籍列表构建全文索引（不持 DB 锁，重活应放 blocking 线程）
pub fn build_index_from_books(app_data_dir: &Path, books: &[Book]) -> Result<(), String> {
    let index_dir = app_data_dir.join("index");
    // 幂等：重建前先删除旧索引，保证 reindex 可重复执行
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
    }
    // tantivy 0.22 的 create_in_dir 不会自动创建目录，需先建好
    fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;
    let (schema, fields) = schema();
    let mut index = Index::create_in_dir(&index_dir, schema).map_err(|e| e.to_string())?;
    index.set_tokenizers(tokenizers());
    let mut writer = index.writer(50_000_000).map_err(|e| e.to_string())?;
    for book in books {
        let p = Path::new(&book.path);
        for (section, location) in extract_sections(&book.format, p) {
            if section.trim().is_empty() {
                continue;
            }
            writer
                .add_document(doc!(
                    fields.id => book.id.to_string(),
                    fields.title => book.title.clone(),
                    fields.text => section,
                    fields.location => location,
                    fields.format => book.format.clone(),
                ))
                .map_err(|e| e.to_string())?;
        }
    }
    writer.commit().map_err(|e| e.to_string())?;
    // 写入 schema 版本标记，便于检测旧索引自动重建
    fs::write(app_data_dir.join(INDEX_VERSION_FILE), SCHEMA_VERSION)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 索引是否已构建且 schema 版本匹配（以 meta.json + 版本标记为准）
pub fn index_exists(app_data_dir: &Path) -> bool {
    let version_ok = fs::read_to_string(app_data_dir.join(INDEX_VERSION_FILE))
        .map(|s| s.trim() == SCHEMA_VERSION)
        .unwrap_or(false);
    version_ok && app_data_dir.join("index").join("meta.json").is_file()
}

/// 删除某本书在索引中的所有文档（tantivy 按 book_id term 精准删除）
pub fn delete_book_from_index(app_data_dir: &Path, book_id: i64) -> Result<(), String> {
    if !index_exists(app_data_dir) {
        return Ok(());
    }
    let index_dir = app_data_dir.join("index");
    let (_schema, fields) = schema();
    let mut index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
    index.set_tokenizers(tokenizers());
    let mut writer: tantivy::indexer::IndexWriter<TantivyDocument> =
        index.writer(30_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(fields.id, &book_id.to_string()));
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 从整段文本中截取围绕命中的片段，并在 Rust 侧完成边界截断
pub fn snippet(text: &str, query: &str, radius: usize) -> String {
    let lower_text = text.to_lowercase();
    let trimmed = query.trim();
    let mut needle = trimmed.to_lowercase();
    let mut idx = if needle.is_empty() {
        None
    } else {
        lower_text.find(&needle)
    };
    if idx.is_none() {
        // 整句未命中（如分词差异）时退化为第一个词
        if let Some(word) = needle.split_whitespace().next() {
            needle = word.to_string();
            idx = lower_text.find(&needle);
        }
    }
    let idx = idx.unwrap_or(0);
    let start = char_boundary(text, idx.saturating_sub(radius));
    let end = char_boundary(text, (idx + needle.len() + radius).min(text.len()));
    let mut s = text[start..end].replace(['\n', '\r'], " ");
    let words: Vec<&str> = s.split_whitespace().collect();
    s = words.join(" ");
    if start > 0 {
        s = format!("…{s}");
    }
    if end < text.len() {
        s = format!("{s}…");
    }
    s
}

fn char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

pub fn search(app_data_dir: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let index_dir = app_data_dir.join("index");
    let (_schema, fields) = schema();
    let mut index = Index::open_in_dir(&index_dir).map_err(|e| format!("索引未就绪: {e}"))?;
    index.set_tokenizers(tokenizers());
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&index, vec![fields.title, fields.text]);
    let parsed = parser.parse_query(query).map_err(|e| format!("查询语法错误: {e}"))?;
    let top = searcher.search(&parsed, &TopDocs::with_limit(limit)).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for (_score, doc_address) in top {
        let retrieved: TantivyDocument = searcher.doc(doc_address).map_err(|e| e.to_string())?;
        let book_id: u64 = retrieved
            .get_first(fields.id)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let title = retrieved
            .get_first(fields.title)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let format = retrieved
            .get_first(fields.format)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let location = retrieved
            .get_first(fields.location)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let full_text = retrieved
            .get_first(fields.text)
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let text = snippet(full_text, query, SNIPPET_RADIUS);
        hits.push(SearchHit { book_id, title, format, text, location });
    }
    Ok(hits)
}

// ---------- 轻量 XML 辅助 ----------

const INDEX_VERSION_FILE: &str = "index/schema_version";

fn read_entry(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut f = archive.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = s.find(start)?;
    let rest = &s[i + start.len()..];
    let j = rest.find(end)?;
    Some(&rest[..j])
}

fn attr(s: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pat = format!("{name}={quote}");
        if let Some(i) = s.find(&pat) {
            let rest = &s[i + pat.len()..];
            let end = rest.find(quote)?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn resolve_relative_path(base_dir: &str, href: &str) -> String {
    let combined = if base_dir.is_empty() {
        href.to_string()
    } else {
        format!("{base_dir}/{href}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_slices_around_query() {
        let text = "这是正文的开头部分。云上的日子十分漫长，太阳缓缓落下。这是正文的结尾部分。";
        let s = snippet(text, "漫长", 10);
        assert!(s.contains("漫长"));
        assert!(s.len() < text.len());
        assert!(s.starts_with('…'));
        assert!(s.ends_with('…'));
    }

    #[test]
    fn snippet_falls_back_to_first_word() {
        let text = "今天天气很好，适合读书和散步。";
        let s = snippet(text, "找不到 天气", 8);
        assert!(s.contains("天气"));
    }

    #[test]
    fn snippet_handles_empty_query() {
        let text = "没有任何匹配的文字。";
        let s = snippet(text, "  ", 5);
        assert!(!s.is_empty());
    }

    #[test]
    fn text_sections_carry_line_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        let mut content = String::new();
        for i in 0..250 {
            content.push_str(&format!("第{i}行内容\n"));
        }
        std::fs::write(&p, &content).unwrap();
        let sections = extract_text_sections(&p);
        assert!(sections.len() >= 2);
        assert_eq!(sections[0].1, "line:0");
        assert_eq!(sections[1].1, format!("line:{}", LINE_CHUNK));
    }

    #[test]
    fn resolve_relative_path_normalizes_dotdot() {
        assert_eq!(resolve_relative_path("OEBPS", "chapters/../c1.xhtml"), "OEBPS/c1.xhtml");
        assert_eq!(resolve_relative_path("", "cover.jpg"), "cover.jpg");
        assert_eq!(resolve_relative_path("META-INF/..", "OEBPS/book.opf"), "OEBPS/book.opf");
    }

    #[test]
    fn attr_parses_double_and_single_quotes() {
        assert_eq!(attr(r#"<rootfile full-path="OEBPS/package.opf" />"#, "full-path"),
                   Some("OEBPS/package.opf".into()));
        assert_eq!(attr("<item href='c1.xhtml'/>", "href"), Some("c1.xhtml".into()));
        assert_eq!(attr("<a/>", "missing"), None);
    }
}
