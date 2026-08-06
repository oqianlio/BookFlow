// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod db;

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
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
