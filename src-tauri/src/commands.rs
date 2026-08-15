use crate::cookies::{CookieJarManager, sanitize_key};
use crate::db::*;
use crate::import::import_file;
use crate::tts::TtsEngine;
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    pub tts: TtsEngine,
    pub cookies: CookieJarManager,
    /// 按 cookie jar（host）复用的 reqwest blocking Client，保 keep-alive/连接池
    pub http_clients: Arc<Mutex<HashMap<String, Arc<reqwest::blocking::Client>>>>,
}

impl AppState {
    pub fn books_dir(&self) -> PathBuf {
        self.app_data_dir.join("books")
    }

    /// 持锁执行 DB 操作；锁中毒时返回可恢复错误而非 panic
    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let conn = self.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        f(&conn)
    }
}

#[tauri::command]
pub async fn import_books(files: Vec<String>, state: State<'_, AppState>) -> Result<Vec<Book>, String> {
    let books_root = state.books_dir();
    fs::create_dir_all(&books_root).map_err(|e| e.to_string())?;
    let mut imported = Vec::new();
    for f in &files {
        let src = PathBuf::from(f);
        let imported_file = match import_file(&src, &books_root) {
            Ok(if_) => if_,
            Err(e) => {
                eprintln!("导入失败 {}: {}", src.display(), e);
                continue;
            }
        };
        // EPUB 导入时提取封面图（失败不影响导入，PDF/MD/TXT 用占位封面）
        let cover_path = if imported_file.format == "epub" {
            crate::cover::extract_epub_cover(&imported_file.dest, &books_root)
                .map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        };
        let new_book = NewBook {
            title: imported_file.title,
            format: imported_file.format,
            path: imported_file.dest.to_string_lossy().into_owned(),
            cover_path,
        };
        let id = state.with_db(|conn| upsert_book(conn, &new_book).map_err(|e| e.to_string())).map_err(|e| {
            eprintln!("写入数据库失败 {}: {}", src.display(), e);
            format!("导入失败 {}: {}", src.display(), e)
        })?;
        match state.with_db(|conn| get_book(conn, id).map_err(|e| e.to_string())) {
            Ok(Some(b)) => imported.push(b),
            Ok(None) => eprintln!("导入后未找到记录 {}: {}", src.display(), id),
            Err(e) => eprintln!("读取导入记录失败 {}: {}", src.display(), e),
        }
    }
    // 导入后重建全文索引（锁外重活，不阻塞 DB 与 UI）
    if !imported.is_empty() {
        let app_data_dir = state.app_data_dir.clone();
        let books = state.with_db(|conn| crate::search::collect_books(conn))?;
        if let Err(e) = tauri::async_runtime::spawn_blocking(move || {
            crate::search::build_index_from_books(&app_data_dir, &books)
        })
        .await
        {
            eprintln!("重建搜索索引失败: {e:?}");
        }
    }
    Ok(imported)
}

#[tauri::command]
pub fn list_books_cmd(state: State<'_, AppState>) -> Result<Vec<Book>, String> {
    list_books(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_book(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let path: Option<String> = conn
        .query_row("SELECT path FROM books WHERE id = ?1", [id], |r| r.get(0))
        .ok();
    let cover_path: Option<Option<String>> = conn
        .query_row("SELECT cover_path FROM books WHERE id = ?1", [id], |r| r.get(0))
        .ok();
    delete_book(&conn, id).map_err(|e| e.to_string())?;
    drop(conn);
    if let Some(p) = path {
        let _ = fs::remove_file(&p);
        // 兼容旧版本导入时写入的 `<书>_cover.jpg`
        let _ = fs::remove_file(format!("{p}.jpg"));
    }
    if let Some(cp) = cover_path.flatten() {
        let _ = fs::remove_file(&cp);
    }
    // 同步删除全文索引中的该书文档，避免删除后仍被搜到
    if let Err(e) = crate::search::delete_book_from_index(&state.app_data_dir, id) {
        eprintln!("删除索引条目失败 book_id={id}: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn save_progress_cmd(book_id: i64, location: String, percent: f64, state: State<'_, AppState>) -> Result<(), String> {
    save_progress(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, book_id, &location, percent).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_progress_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Option<(String, f64)>, String> {
    get_progress(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_annotation_cmd(
    book_id: i64, format: String, location: String, text: String,
    note: Option<String>, color: String, state: State<'_, AppState>,
) -> Result<i64, String> {
    add_annotation(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &NewAnnotation {
        book_id, format, location, text, note, color,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_annotations_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
    list_annotations(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_annotation_cmd(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_annotation(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark_cmd(book_id: i64, location: String, label: String, state: State<'_, AppState>) -> Result<i64, String> {
    add_bookmark(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &NewBookmark {
        book_id, location, label,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bookmarks_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Vec<Bookmark>, String> {
    list_bookmarks(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark_cmd(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_bookmark(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

/// 读取文本文件（UTF-8/UTF-16/GBK 自动识别）。命令层先做路径白名单校验。
fn read_text_bytes(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    crate::net::decode_body(&bytes, None)
}

#[tauri::command]
pub fn read_file_content(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    crate::net::ensure_within(&state.app_data_dir, &p)?;
    read_text_bytes(&p)
}

#[cfg(test)]
mod tests {
    use super::read_text_bytes;
    use crate::net::ensure_within;

    #[test]
    fn read_utf8_and_gbk_fallback() {
        let dir = tempfile::tempdir().unwrap();

        let utf8_path = dir.path().join("utf8.txt");
        std::fs::write(&utf8_path, "你好，世界").unwrap();
        assert_eq!(read_text_bytes(&utf8_path).unwrap(), "你好，世界");

        let gbk_path = dir.path().join("gbk.txt");
        let (gbk_bytes, _, _) = encoding_rs::GBK.encode("你好，世界");
        std::fs::write(&gbk_path, gbk_bytes.as_ref()).unwrap();
        assert_eq!(read_text_bytes(&gbk_path).unwrap(), "你好，世界");

        let missing = dir.path().join("missing.txt");
        assert!(read_text_bytes(&missing).is_err());
    }

    #[test]
    fn ensure_within_allows_inside_and_rejects_outside() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let inside = root.path().join("books/a.txt");
        std::fs::create_dir_all(inside.parent().unwrap()).unwrap();
        std::fs::write(&inside, "x").unwrap();
        let out = outside.path().join("b.txt");
        std::fs::write(&out, "y").unwrap();
        assert!(ensure_within(root.path(), &inside).is_ok());
        assert!(ensure_within(root.path(), &out).is_err());
    }
}

#[tauri::command]
pub fn set_setting_cmd(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    set_setting(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting_cmd(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    get_setting(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &key).map_err(|e| e.to_string())
}

use crate::search::SearchHit;

#[tauri::command]
pub async fn search_books(query: String, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    let app_data_dir = state.app_data_dir.clone();
    // 懒构建：仅当索引缺失（如首次搜索）时自动重建；查询语法等真实错误原样返回。
    // 锁内只收集书籍列表，索引构建在 blocking 线程执行（不阻塞 DB 与 UI）
    if !crate::search::index_exists(&app_data_dir) {
        let books = state.with_db(|conn| crate::search::collect_books(conn))?;
        let dir = app_data_dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::search::build_index_from_books(&dir, &books)
        })
        .await
        .map_err(|e| format!("索引构建任务失败: {e}"))??;
    }
    tauri::async_runtime::spawn_blocking(move || crate::search::search(&app_data_dir, &query, 100))
        .await
        .map_err(|e| format!("搜索任务失败: {e}"))?
}

#[tauri::command]
pub async fn reindex(state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = state.app_data_dir.clone();
    let books = state.with_db(|conn| crate::search::collect_books(conn))?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::search::build_index_from_books(&app_data_dir, &books)
    })
    .await
    .map_err(|e| format!("索引重建任务失败: {e}"))?
}

#[tauri::command]
pub fn tts_speak(text: String, rate: f64, state: State<'_, AppState>) -> Result<(), String> {
    state.tts.set_rate(rate);
    state.tts.speak(&text)
}

#[tauri::command]
pub fn tts_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.tts.stop()
}

#[tauri::command]
pub fn list_book_sources(state: State<'_, AppState>) -> Result<Vec<SourceRow>, String> {
    list_sources(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_book_source(name: String, url: String, json: String, state: State<'_, AppState>) -> Result<i64, String> {
    add_source(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &name, &url, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_book_source(id: i64, name: String, url: String, json: String, state: State<'_, AppState>) -> Result<(), String> {
    update_source(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id, &name, &url, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_book_source(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_source(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_book_source_enabled(id: i64, enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    set_source_enabled(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_book_source_progress(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Option<SourceProgress>, String> {
    get_source_progress(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_book_source_progress(
    source_id: i64,
    book_url: String,
    title: String,
    chapter_index: i64,
    chapter_url: String,
    chapter_name: String,
    percent: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    save_source_progress(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &NewSourceProgress {
        source_id, book_url, title, chapter_index, chapter_url, chapter_name, percent,
    }).map_err(|e| e.to_string())
}

/// 打开书源登录窗口（WebViewWindow 加载 loginUrl）。
/// 窗口关闭（Destroyed）后，用该书源 jar 对域名首页发一次请求，
/// 吸收登录流程产生的 Set-Cookie 并持久化到 `<cookies dir>/<key>.json`。
#[tauri::command]
pub fn open_login_window(url: String, cookie_jar: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let login_url = tauri::WebviewUrl::External(url.parse().map_err(|e| format!("URL 无效: {e}"))?);
    let label = format!("login_{}", sanitize_key(&cookie_jar));
    // 同书源登录窗口已存在时直接聚焦，避免重复创建报 LabelAlreadyExists
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(&app, label.as_str(), login_url)
        .title("书源登录")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| format!("打开登录窗口失败: {e}"))?;

    let mgr = app.state::<AppState>().cookies.clone();
    let jar_key = cookie_jar;
    let _ = window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Destroyed) || jar_key.is_empty() {
            return;
        }
        let mgr = mgr.clone();
        let key = jar_key.clone();
        let url = format!("https://{key}/");
        std::thread::spawn(move || {
            let jar = mgr.jar_for(&key);
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_millis(crate::net::DEFAULT_TIMEOUT_MS))
                .cookie_provider(jar.clone())
                .build();
            if let Ok(c) = client {
                let _ = c
                    .get(&url)
                    .header(reqwest::header::USER_AGENT, crate::net::DEFAULT_UA)
                    .send();
                jar.save();
            }
        });
    });
    Ok(())
}

#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    match level.as_str() {
        "error" => eprintln!("[前端 error] {}", message),
        "warn" => eprintln!("[前端 warn] {}", message),
        _ => println!("[前端 {}] {}", level, message),
    }
}

#[tauri::command]
pub fn add_shelf_source_book(
    source_id: i64,
    book_url: String,
    title: String,
    author: Option<String>,
    cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    crate::db::add_shelf_source_book(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &crate::db::NewShelfSourceBook {
        source_id, book_url, title, author, cover_url,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_shelf_source_books(state: State<'_, AppState>) -> Result<Vec<crate::db::ShelfSourceBook>, String> {
    crate::db::list_shelf_source_books(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_shelf_source_book(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::remove_shelf_source_book(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct CachedChapterInput {
    pub source_id: i64,
    pub book_url: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub content: String,
}

#[tauri::command]
pub fn save_cached_chapter(input: CachedChapterInput, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::save_cached_chapter(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &crate::db::NewCachedChapter {
        source_id: input.source_id, book_url: input.book_url,
        chapter_index: input.chapter_index, chapter_url: input.chapter_url,
        chapter_name: input.chapter_name, content: input.content,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_cached_chapters(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Vec<crate::db::CachedChapter>, String> {
    crate::db::list_cached_chapters(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cached_chapter(source_id: i64, book_url: String, chapter_url: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    crate::db::get_cached_chapter(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url, &chapter_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_book_cache(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::delete_book_cache(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_read(source_id: i64, book_url: String, title: String, seconds: i64, increment_count: bool, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::record_read(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url, &title, seconds, increment_count).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_reading_stats(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Option<crate::db::ReadingStats>, String> {
    crate::db::get_reading_stats(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, source_id, &book_url).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct RssFeedPreviewOut {
    pub title: String,
    pub site_url: Option<String>,
    pub articles: Vec<crate::rss::RssArticlePreviewOut>,
}

#[tauri::command]
pub fn fetch_rss_feed(url: String) -> Result<RssFeedPreviewOut, String> {
    let xml = crate::rss::http_get_xml(&url)?;
    let preview = crate::rss::parse_rss_xml(&xml)?;
    Ok(RssFeedPreviewOut {
        title: preview.title,
        site_url: preview.site_url,
        articles: preview.articles.into_iter().map(|a| a.into()).collect(),
    })
}

#[tauri::command]
pub fn add_rss_feed(url: String, state: State<'_, AppState>) -> Result<i64, String> {
    let xml = crate::rss::http_get_xml(&url)?;
    let preview = crate::rss::parse_rss_xml(&xml)?;
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    // feed + 全部文章写入同一事务，避免部分成功留下不完整订阅
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let id = crate::db::add_rss_feed_db(&tx, &preview.title, &url, preview.site_url.as_deref()).map_err(|e| e.to_string())?;
    for a in &preview.articles {
        crate::db::upsert_rss_article(&tx, id, a).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn refresh_rss_feed(feed_id: i64, state: State<'_, AppState>) -> Result<i64, String> {
    let row = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        crate::db::get_rss_feed_db(&conn, feed_id).map_err(|e| e.to_string())?.ok_or("订阅源不存在")?
    };
    let xml = crate::rss::http_get_xml(&row.url)?;
    let preview = crate::rss::parse_rss_xml(&xml)?;
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut added = 0i64;
    for a in &preview.articles {
        added += crate::db::upsert_rss_article(&conn, feed_id, a).map_err(|e| e.to_string())?;
    }
    Ok(added)
}

#[tauri::command]
pub fn list_rss_feeds(state: State<'_, AppState>) -> Result<Vec<crate::db::RssFeedRow>, String> {
    crate::db::list_rss_feeds_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_rss_feed(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::delete_rss_feed_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_rss_articles(feed_id: i64, state: State<'_, AppState>) -> Result<Vec<crate::db::RssArticleRow>, String> {
    crate::db::list_rss_articles_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, feed_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_rss_article(id: i64, state: State<'_, AppState>) -> Result<Option<crate::db::RssArticleRow>, String> {
    crate::db::get_rss_article_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_subscription(url: String, state: State<'_, AppState>) -> Result<i64, String> {
    let text = crate::rss::http_get_xml(&url)?;
    let name = crate::rss::extract_first_source_name(&text).unwrap_or_else(|| "订阅源".to_string());
    crate::db::add_subscription_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &name, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_subscriptions(state: State<'_, AppState>) -> Result<Vec<crate::db::SubscriptionRow>, String> {
    crate::db::list_subscriptions_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_subscription(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::delete_subscription_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_subscription_checked(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::set_subscription_checked_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_source_by_url(url: String, state: State<'_, AppState>) -> Result<Option<crate::db::SourceRow>, String> {
    crate::db::get_source_by_url_db(&*state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    // 写入目标可能尚不存在：校验父目录在数据目录内
    if let Some(parent) = p.parent().filter(|x| !x.as_os_str().is_empty()) {
        crate::net::ensure_within(&state.app_data_dir, parent)?;
    }
    std::fs::write(&p, content).map_err(|e| format!("写入文件失败: {e}"))
}

#[derive(serde::Serialize)]
pub struct FontFileRow {
    pub name: String,
    pub file: String,
}

/// 复制本地字体文件到应用 fonts 目录（防冲突文件名），返回显示名与存储名
#[tauri::command]
pub fn copy_font_file(src: String, state: State<'_, AppState>) -> Result<FontFileRow, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    // 源文件只接受常见字体格式（配合前端 dialog 过滤，命令层防御）
    const ALLOWED_EXTS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];
    let src_path = std::path::PathBuf::from(&src);
    let ext = src_path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!("不支持的字体格式: {ext}"));
    }
    let fonts_dir = state.app_data_dir.join("fonts");
    std::fs::create_dir_all(&fonts_dir).map_err(|e| format!("创建字体目录失败: {e}"))?;
    let stem = src_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "font".to_string());
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let file = format!("{}_{}.{}", stem, ts, ext);
    std::fs::copy(&src_path, fonts_dir.join(&file)).map_err(|e| format!("复制字体文件失败: {e}"))?;
    Ok(FontFileRow { name: stem, file })
}

/// 列出已导入字体
#[tauri::command]
pub fn list_font_files(state: State<'_, AppState>) -> Result<Vec<FontFileRow>, String> {
    let fonts_dir = state.app_data_dir.join("fonts");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&fonts_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().into_owned();
            let name = entry
                .path()
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| fname.clone());
            out.push(FontFileRow { name, file: fname });
        }
    }
    Ok(out)
}
