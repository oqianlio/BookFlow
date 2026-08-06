use crate::db::init_db;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub struct ImportedFile {
    pub dest: PathBuf,
    pub format: String,
    pub title: String,
}

pub fn detect_format(path: &Path) -> Option<String> {
    match path.extension()?.to_str()?.to_lowercase().as_str() {
        "epub" => Some("epub".into()),
        "pdf" => Some("pdf".into()),
        "md" | "markdown" => Some("md".into()),
        "txt" => Some("txt".into()),
        _ => None,
    }
}

pub fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未命名".into())
}

pub fn unique_dest(books_root: &Path, file_name: &str) -> PathBuf {
    let mut dest = books_root.join(file_name);
    if !dest.exists() {
        return dest;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = Path::new(file_name)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    let mut i = 1;
    loop {
        dest = books_root.join(format!("{stem}_{i}{ext}"));
        if !dest.exists() {
            return dest;
        }
        i += 1;
    }
}

pub fn import_file(src: &Path, books_root: &Path) -> Result<ImportedFile, String> {
    let format = detect_format(src).ok_or_else(|| format!("不支持的文件格式: {}", src.display()))?;
    if !src.is_file() {
        return Err(format!("文件不存在: {}", src.display()));
    }
    let file_name = src.file_name().ok_or("无法获取文件名")?.to_string_lossy().into_owned();
    let dest = unique_dest(books_root, &file_name);
    fs::copy(src, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(ImportedFile {
        dest,
        format,
        title: title_from_path(src),
    })
}

pub fn open_app_db(app_data_dir: &Path) -> Result<Connection, String> {
    init_db(&app_data_dir.join("reader.db")).map_err(|e| e.to_string())
}
