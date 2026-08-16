// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod db;
pub mod import;
pub mod commands;
pub mod cookies;
pub mod cover;
pub mod logs;
pub mod net;
pub mod rss;
pub mod search;
pub mod tts;

use commands::*;
use cookies::CookieJarManager;
use tauri::Manager;
use tauri_plugin_dialog;
use tauri_plugin_fs;
use tauri_plugin_opener;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！这是来自 Rust 的问候！", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_data_dir).expect("创建应用数据目录失败");
            std::fs::create_dir_all(app_data_dir.join("books")).ok();
            let conn = import::open_app_db(&app_data_dir)?;
            let cookies = CookieJarManager::new(app_data_dir.join("cookies"));
            app.manage(AppState {
                db: std::sync::Mutex::new(conn),
                app_data_dir,
                tts: crate::tts::TtsEngine::new(),
                cookies,
                http_clients: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            import_books, list_books_cmd, remove_book,
            save_progress_cmd, get_progress_cmd,
            add_annotation_cmd, list_annotations_cmd, delete_annotation_cmd,
            add_bookmark_cmd, list_bookmarks_cmd, delete_bookmark_cmd,
            read_file_content, set_setting_cmd, get_setting_cmd,
            search_books, reindex,
            tts_speak, tts_stop,
            crate::net::http_get,
            list_book_sources, add_book_source, update_book_source,
            delete_book_source, set_book_source_enabled,
            get_book_source_progress, save_book_source_progress,
            open_login_window,
            log_frontend, read_logs, clear_logs, log_file_size,
            add_shelf_source_book, list_shelf_source_books, remove_shelf_source_book,
            save_cached_chapter, list_cached_chapters, get_cached_chapter, delete_book_cache,
            cache_summary, clear_all_cache,
            record_read, get_reading_stats,
            fetch_rss_feed, add_rss_feed, refresh_rss_feed,
            list_rss_feeds, delete_rss_feed, list_rss_articles, get_rss_article,
            add_subscription, list_subscriptions, delete_subscription,
            set_subscription_checked, get_source_by_url, write_text_file,
            copy_font_file, list_font_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
