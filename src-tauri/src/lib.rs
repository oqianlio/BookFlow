// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod db;
pub mod import;
pub mod commands;

use commands::*;
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
            app.manage(AppState { db: std::sync::Mutex::new(conn), app_data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            import_books, list_books_cmd, remove_book,
            save_progress_cmd, get_progress_cmd,
            add_annotation_cmd, list_annotations_cmd, delete_annotation_cmd,
            add_bookmark_cmd, list_bookmarks_cmd, delete_bookmark_cmd,
            set_setting_cmd, get_setting_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
