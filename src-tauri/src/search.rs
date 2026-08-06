use crate::db::list_books;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value};
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchHit {
    pub book_id: u64,
    pub title: String,
    pub format: String,
    pub text: String,
    pub location: String,
}

fn schema() -> (Schema, Field, Field, Field) {
    let mut b = Schema::builder();
    // book_id 用字符串存储，便于检索不参与评分
    let id_opts = TextOptions::default().set_stored();
    let id = b.add_text_field("book_id", id_opts);
    let text_opts = TextOptions::default()
        .set_stored()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("cjk")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        );
    let title = b.add_text_field("title", text_opts.clone());
    let text = b.add_text_field("text", text_opts);
    (b.build(), id, title, text)
}

fn extract_text(format: &str, path: &Path) -> String {
    match format {
        "md" | "txt" => fs::read_to_string(path).unwrap_or_default(),
        "epub" => extract_epub_text(path),
        "pdf" => extract_pdf_text(path),
        _ => String::new(),
    }
}

fn extract_epub_text(path: &Path) -> String {
    // 解析 EPUB 的 OEBPS 内容；简化：用 zip 遍历解压后的 HTML，去标签。
    let mut out = String::new();
    if let Ok(file) = std::fs::File::open(path) {
        let mut archive = match zip::ZipArchive::new(file) {
            Ok(a) => a,
            Err(_) => return out,
        };
        for i in 0..archive.len() {
            let mut f = match archive.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let name = f.name().to_lowercase();
            if name.ends_with(".html") || name.ends_with(".xhtml") || name.ends_with(".htm") {
                let mut s = String::new();
                use std::io::Read;
                if f.read_to_string(&mut s).is_ok() {
                    out.push_str(&strip_html(&s));
                    out.push('\n');
                }
            }
        }
    }
    out
}

fn extract_pdf_text(path: &Path) -> String {
    match pdf_extract::extract_text(path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("PDF 文本提取失败，PDF 搜索暂不可用: {e}");
            String::new()
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

pub fn build_index(app_data_dir: &Path, conn: &Connection) -> Result<(), String> {
    let index_dir = app_data_dir.join("index");
    // 幂等：重建前先删除旧索引，保证 reindex 可重复执行
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
    }
    // tantivy 0.22 的 create_in_dir 不会自动创建目录，需先建好
    fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;
    let (schema, id_f, title_f, text_f) = schema();
    let mut index = Index::create_in_dir(&index_dir, schema).map_err(|e| e.to_string())?;
    index.set_tokenizers(tokenizers());
    let mut writer = index.writer(50_000_000).map_err(|e| e.to_string())?;
    for book in list_books(conn).map_err(|e| e.to_string())? {
        let p = Path::new(&book.path);
        let text = extract_text(&book.format, p);
        writer
            .add_document(doc!(
                id_f => book.id.to_string(),
                title_f => book.title.clone(),
                text_f => text,
            ))
            .map_err(|e| e.to_string())?;
    }
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 索引是否已构建（以 tantivy 写入的 meta.json 是否存在为准）
pub fn index_exists(app_data_dir: &Path) -> bool {
    app_data_dir.join("index").join("meta.json").is_file()
}

pub fn search(app_data_dir: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let index_dir = app_data_dir.join("index");
    let (_schema, id_f, title_f, text_f) = schema();
    let mut index = Index::open_in_dir(&index_dir).map_err(|e| format!("索引未就绪: {e}"))?;
    index.set_tokenizers(tokenizers());
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&index, vec![title_f, text_f]);
    let query = parser.parse_query(query).map_err(|e| format!("查询语法错误: {e}"))?;
    let top = searcher.search(&query, &TopDocs::with_limit(limit)).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for (_score, doc_address) in top {
        let retrieved: tantivy::schema::TantivyDocument = searcher.doc(doc_address).map_err(|e| e.to_string())?;
        hits.push(SearchHit {
            book_id: retrieved.get_first(id_f).and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0),
            title: retrieved.get_first(title_f).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            format: String::new(),
            text: retrieved.get_first(text_f).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            location: String::new(),
        });
    }
    Ok(hits)
}
