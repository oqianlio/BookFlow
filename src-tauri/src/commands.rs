use crate::cookies::{CookieJarManager, sanitize_key};
use crate::db::*;
use crate::import::import_file;
use crate::tts::TtsEngine;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    pub tts: TtsEngine,
    pub cookies: CookieJarManager,
}

impl AppState {
    pub fn books_dir(&self) -> PathBuf {
        self.app_data_dir.join("books")
    }
}

#[tauri::command]
pub fn import_books(files: Vec<String>, state: State<'_, AppState>) -> Result<Vec<Book>, String> {
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
        let id = upsert_book(&state.db.lock().unwrap(), &new_book).map_err(|e| {
            eprintln!("写入数据库失败 {}: {}", src.display(), e);
            format!("导入失败 {}: {}", src.display(), e)
        })?;
        match get_book(&state.db.lock().unwrap(), id) {
            Ok(Some(b)) => imported.push(b),
            Ok(None) => eprintln!("导入后未找到记录 {}: {}", src.display(), id),
            Err(e) => eprintln!("读取导入记录失败 {}: {}", src.display(), e),
        }
    }
    // 导入后重建全文索引，保证新书可立即被搜索到
    if !imported.is_empty() {
        if let Err(e) = crate::search::build_index(&state.app_data_dir, &state.db.lock().unwrap()) {
            eprintln!("重建搜索索引失败: {e}");
        }
    }
    Ok(imported)
}

#[tauri::command]
pub fn list_books_cmd(state: State<'_, AppState>) -> Result<Vec<Book>, String> {
    list_books(&state.db.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_book(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
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
    save_progress(&state.db.lock().unwrap(), book_id, &location, percent).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_progress_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Option<(String, f64)>, String> {
    get_progress(&state.db.lock().unwrap(), book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_annotation_cmd(
    book_id: i64, format: String, location: String, text: String,
    note: Option<String>, color: String, state: State<'_, AppState>,
) -> Result<i64, String> {
    add_annotation(&state.db.lock().unwrap(), &NewAnnotation {
        book_id, format, location, text, note, color,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_annotations_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Vec<Annotation>, String> {
    list_annotations(&state.db.lock().unwrap(), book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_annotation_cmd(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_annotation(&state.db.lock().unwrap(), id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark_cmd(book_id: i64, location: String, label: String, state: State<'_, AppState>) -> Result<i64, String> {
    add_bookmark(&state.db.lock().unwrap(), &NewBookmark {
        book_id, location, label,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bookmarks_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Vec<Bookmark>, String> {
    list_bookmarks(&state.db.lock().unwrap(), book_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark_cmd(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_bookmark(&state.db.lock().unwrap(), id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let text = match std::str::from_utf8(&bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => encoding_rs::GBK.decode(&bytes).0.into_owned(),
    };
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::read_file_content;

    #[test]
    fn read_utf8_and_gbk_fallback() {
        let dir = tempfile::tempdir().unwrap();

        let utf8_path = dir.path().join("utf8.txt");
        std::fs::write(&utf8_path, "你好，世界").unwrap();
        assert_eq!(
            read_file_content(utf8_path.to_string_lossy().into_owned()).unwrap(),
            "你好，世界"
        );

        let gbk_path = dir.path().join("gbk.txt");
        let (gbk_bytes, _, _) = encoding_rs::GBK.encode("你好，世界");
        std::fs::write(&gbk_path, gbk_bytes.as_ref()).unwrap();
        assert_eq!(
            read_file_content(gbk_path.to_string_lossy().into_owned()).unwrap(),
            "你好，世界"
        );

        let missing = dir.path().join("missing.txt");
        assert!(read_file_content(missing.to_string_lossy().into_owned()).is_err());
    }
}

#[tauri::command]
pub fn set_setting_cmd(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    set_setting(&state.db.lock().unwrap(), &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting_cmd(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    get_setting(&state.db.lock().unwrap(), &key).map_err(|e| e.to_string())
}

use crate::search::SearchHit;

#[tauri::command]
pub fn search_books(query: String, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    // 懒构建：仅当索引缺失（如首次搜索）时自动重建；查询语法等真实错误原样返回
    if !crate::search::index_exists(&state.app_data_dir) {
        crate::search::build_index(&state.app_data_dir, &state.db.lock().unwrap())?;
    }
    crate::search::search(&state.app_data_dir, &query, 100)
}

#[tauri::command]
pub fn reindex(state: State<'_, AppState>) -> Result<(), String> {
    crate::search::build_index(&state.app_data_dir, &state.db.lock().unwrap())
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
    list_sources(&state.db.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_book_source(name: String, url: String, json: String, state: State<'_, AppState>) -> Result<i64, String> {
    add_source(&state.db.lock().unwrap(), &name, &url, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_book_source(id: i64, name: String, url: String, json: String, state: State<'_, AppState>) -> Result<(), String> {
    update_source(&state.db.lock().unwrap(), id, &name, &url, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_book_source(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    delete_source(&state.db.lock().unwrap(), id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_book_source_enabled(id: i64, enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    set_source_enabled(&state.db.lock().unwrap(), id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_book_source_progress(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Option<SourceProgress>, String> {
    get_source_progress(&state.db.lock().unwrap(), source_id, &book_url).map_err(|e| e.to_string())
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
    save_source_progress(&state.db.lock().unwrap(), &NewSourceProgress {
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
