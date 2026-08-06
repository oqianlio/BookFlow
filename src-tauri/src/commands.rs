use crate::db::*;
use crate::import::import_file;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
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
        let new_book = NewBook {
            title: imported_file.title,
            format: imported_file.format,
            path: imported_file.dest.to_string_lossy().into_owned(),
            cover_path: None,
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
    delete_book(&conn, id).map_err(|e| e.to_string())?;
    if let Some(p) = path {
        let _ = fs::remove_file(&p);
        let _ = fs::remove_file(format!("{p}.jpg"));
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
