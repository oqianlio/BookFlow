# 桌面阅读器「阅卷」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个跨平台桌面阅读器（Tauri 2 + React + SQLite），支持 EPUB/PDF/MD/TXT、书架、标注书签、全文搜索、TTS 朗读与个性化设置。

**Architecture:** React/TS 前端负责渲染与交互，通过 Tauri IPC 调用 Rust 后端；Rust 侧负责文件导入、SQLite 数据库、tantivy 全文索引与系统 TTS。书籍文件复制到应用数据目录统一管理。

**Tech Stack:** Tauri 2, Rust, React 18 + TypeScript + Vite, epub.js, pdf.js, marked, rusqlite, tantivy 0.22, Vitest

**Spec:** `docs/superpowers/specs/2026-08-06-desktop-reader-design.md`

## Global Constraints

- 仅支持 EPUB/PDF/MD/TXT 四种格式；不实现 OCR。
- 前端只通过 `@tauri-apps/api` 的 `invoke` 与事件与后端通信，不直接访问文件系统。
- 所有数据库访问集中在 Rust 侧（rusqlite），数据库文件位于应用数据目录 `reader.db`。
- 书籍文件复制到应用数据目录 `books/`，原始文件不改动。
- 阅读进度：EPUB 用 CFI，PDF/MD/TXT 用页码 + 百分比。
- UI 文案使用中文。
- 平台：Windows / macOS / Linux（开发验证环境为 Windows + pwsh）。
- 所有 SQLite 建表语句使用 `IF NOT EXISTS`，保证幂等。

---

### Task 1: 项目脚手架

**Files:**
- Create: 整个 Tauri 2 + React + TS 项目骨架（`package.json`、`src/`、`src-tauri/`、`vite.config.ts`、`index.html`）
- Test: 无（冒烟验证）

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 Tauri 应用骨架，后续任务在其中添加代码；依赖：react, @tauri-apps/api, @tauri-apps/cli, vitest, typescript

- [ ] **Step 1: 验证工具链**

Run:
```bash
node --version && npm --version && cargo --version && rustc --version
```
Expected: node ≥ 18, cargo ≥ 1.75 均输出版本号。若缺失，先安装（Rust 用 rustup，Node 用官网安装包）。

- [ ] **Step 2: 创建项目**

Run:
```bash
npm create tauri-app@latest yd -- --template react-ts --manager npm --yes
```
如果交互式执行失败，手动创建目录后在该目录内运行同一命令。项目根目录为 `C:\gc\yd`（若脚手架要求非空目录，先在临时目录生成再移动内容）。

- [ ] **Step 3: 验证默认应用可运行**

Run:
```bash
npm install
npm run tauri dev
```
Expected: 窗口弹出显示 React 默认页面，终端无报错。按 `Ctrl+C` 停止。

- [ ] **Step 4: 安装后续依赖**

Run:
```bash
npm install epub.js pdfjs-dist marked
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node
cargo add rusqlite --features bundled
cargo add tantivy@0.22
cargo add tauri-plugin-fs tauri-plugin-dialog tauri-plugin-opener
```

- [ ] **Step 5: 在 `src-tauri/src/lib.rs` 注册插件**

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
同时把三个插件加入 `src-tauri/Cargo.toml` 的 `[dependencies]`（Step 4 已执行，确认存在）以及在 `lib.rs` 顶部加 `use` 声明。

- [ ] **Step 6: 配置 vitest**

`vite.config.ts` 追加：
```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```
创建 `src/test-setup.ts`：
```ts
import "@testing-library/jest-dom";
```
`package.json` 的 `scripts` 添加：`"test": "vitest run"`。

- [ ] **Step 7: 验证构建与测试**

Run:
```bash
npm run build && npm test
```
Expected: build 成功，vitest 输出 "No test files found"（或通过）。

- [ ] **Step 8: 提交**

```bash
git add .
git commit -m "chore: 初始化 Tauri 2 + React + TS 项目脚手架"
```

---

### Task 2: Rust 数据库层（SQLite）

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/main.rs` / `lib.rs` 注册状态与命令
- Test: `src-tauri/tests/db_test.rs`

**Interfaces:**
- Produces:
  - `pub fn init_db(app_data_dir: &Path) -> Result<Connection, rusqlite::Error>` — 打开/创建数据库并建表
  - `pub fn upsert_book(conn: &Connection, book: &NewBook) -> Result<i64, rusqlite::Error>` — 插入或更新书籍，返回 id
  - `pub struct Book { pub id: i64, pub title: String, pub format: String, pub path: String, pub cover_path: Option<String>, pub added_at: i64, pub last_opened_at: Option<i64> }`
  - `pub struct NewBook { pub title: String, pub format: String, pub path: String, pub cover_path: Option<String> }`
  - `pub fn list_books(conn: &Connection) -> Result<Vec<Book>, rusqlite::Error>`
  - `pub fn delete_book(conn: &Connection, id: i64) -> Result<(), rusqlite::Error>`
  - `pub fn save_progress(conn: &Connection, book_id: i64, location: &str, percent: f64) -> Result<(), rusqlite::Error>`
  - `pub fn get_progress(conn: &Connection, book_id: i64) -> Result<Option<(String, f64)>, rusqlite::Error>`
  - `pub fn add_annotation(conn: &Connection, a: &NewAnnotation) -> Result<i64, rusqlite::Error>`
  - `pub fn list_annotations(conn: &Connection, book_id: i64) -> Result<Vec<Annotation>, rusqlite::Error>`
  - `pub fn delete_annotation(conn: &Connection, id: i64) -> Result<(), rusqlite::Error>`
  - `pub fn add_bookmark(conn: &Connection, b: &NewBookmark) -> Result<i64, rusqlite::Error>`
  - `pub fn list_bookmarks(conn: &Connection, book_id: i64) -> Result<Vec<Bookmark>, rusqlite::Error>`
  - `pub fn delete_bookmark(conn: &Connection, id: i64) -> Result<(), rusqlite::Error>`
  - `pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error>`
  - `pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error>`

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/db_test.rs`：
```rust
use std::fs;
use tempfile::tempdir;
use yd_lib::db::*;

#[test]
fn book_crud_and_progress() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let id = upsert_book(&conn, &NewBook {
        title: "测试书".into(), format: "epub".into(),
        path: "books/test.epub".into(), cover_path: None,
    }).unwrap();
    let books = list_books(&conn).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].title, "测试书");
    save_progress(&conn, id, "epubcfi(/6/4)", 0.33).unwrap();
    let p = get_progress(&conn, id).unwrap().unwrap();
    assert_eq!(p.0, "epubcfi(/6/4)");
    assert!((p.1 - 0.33).abs() < 1e-9);
    delete_book(&conn, id).unwrap();
    assert!(list_books(&conn).unwrap().is_empty());
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn annotation_and_bookmark_crud() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let id = upsert_book(&conn, &NewBook {
        title: "b".into(), format: "pdf".into(), path: "b.pdf".into(), cover_path: None,
    }).unwrap();
    let a_id = add_annotation(&conn, &NewAnnotation {
        book_id: id, format: "epub".into(), location: "cfi1".into(),
        text: "高亮文本".into(), note: None, color: "yellow".into(),
    }).unwrap();
    let anns = list_annotations(&conn, id).unwrap();
    assert_eq!(anns.len(), 1);
    assert_eq!(anns[0].text, "高亮文本");
    delete_annotation(&conn, a_id).unwrap();
    let bm_id = add_bookmark(&conn, &NewBookmark {
        book_id: id, location: "cfi2".into(), label: "第一章".into(),
    }).unwrap();
    assert_eq!(list_bookmarks(&conn, id).unwrap().len(), 1);
    delete_bookmark(&conn, bm_id).unwrap();
    assert!(list_bookmarks(&conn, id).unwrap().is_empty());
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn settings_roundtrip() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    set_setting(&conn, "theme", "dark").unwrap();
    assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".into()));
    assert_eq!(get_setting(&conn, "nope").unwrap(), None);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test db_test`
Expected: 编译失败，提示 `yd_lib` 或 `db` 模块不存在。

- [ ] **Step 3: 实现 db.rs**

`src-tauri/src/db.rs`（完整实现）：
```rust
use rusqlite::{params, Connection, Result};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub format: String,
    pub path: String,
    pub cover_path: Option<String>,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewBook {
    pub title: String,
    pub format: String,
    pub path: String,
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Annotation {
    pub id: i64,
    pub book_id: i64,
    pub format: String,
    pub location: String,
    pub text: String,
    pub note: Option<String>,
    pub color: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewAnnotation {
    pub book_id: i64,
    pub format: String,
    pub location: String,
    pub text: String,
    pub note: Option<String>,
    pub color: String,
}

#[derive(Debug, Clone)]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub location: String,
    pub label: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewBookmark {
    pub book_id: i64,
    pub location: String,
    pub label: String,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub fn init_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            format TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            cover_path TEXT,
            added_at INTEGER NOT NULL,
            last_opened_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS reading_progress (
            book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            location TEXT NOT NULL,
            percent REAL NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS annotations (
            id INTEGER PRIMARY KEY,
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            format TEXT NOT NULL,
            location TEXT NOT NULL,
            text TEXT NOT NULL,
            note TEXT,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY,
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            location TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        "#,
    )?;
    Ok(conn)
}

pub fn upsert_book(conn: &Connection, book: &NewBook) -> Result<i64> {
    let t = now();
    conn.execute(
        "INSERT INTO books (title, format, path, cover_path, added_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         ON CONFLICT(path) DO UPDATE SET title = excluded.title, cover_path = excluded.cover_path",
        params![book.title, book.format, book.path, book.cover_path, t],
    )?;
    let id = conn.query_row("SELECT id FROM books WHERE path = ?1", [&book.path], |r| r.get(0))?;
    Ok(id)
}

pub fn list_books(conn: &Connection) -> Result<Vec<Book>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, format, path, cover_path, added_at, last_opened_at
         FROM books ORDER BY COALESCE(last_opened_at, added_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Book {
            id: r.get(0)?, title: r.get(1)?, format: r.get(2)?,
            path: r.get(3)?, cover_path: r.get(4)?, added_at: r.get(5)?,
            last_opened_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn delete_book(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
    Ok(())
}

pub fn save_progress(conn: &Connection, book_id: i64, location: &str, percent: f64) -> Result<()> {
    conn.execute(
        "INSERT INTO reading_progress (book_id, location, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id) DO UPDATE SET location = excluded.location, percent = excluded.percent, updated_at = excluded.updated_at",
        params![book_id, location, percent, now()],
    )?;
    conn.execute("UPDATE books SET last_opened_at = ?1 WHERE id = ?2", params![now(), book_id])?;
    Ok(())
}

pub fn get_progress(conn: &Connection, book_id: i64) -> Result<Option<(String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT location, percent FROM reading_progress WHERE book_id = ?1",
    )?;
    let mut rows = stmt.query([book_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some((row.get(0)?, row.get(1)?)))
    } else {
        Ok(None)
    }
}

pub fn add_annotation(conn: &Connection, a: &NewAnnotation) -> Result<i64> {
    conn.execute(
        "INSERT INTO annotations (book_id, format, location, text, note, color, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![a.book_id, a.format, a.location, a.text, a.note, a.color, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_annotations(conn: &Connection, book_id: i64) -> Result<Vec<Annotation>> {
    let mut stmt = conn.prepare(
        "SELECT id, book_id, format, location, text, note, color, created_at
         FROM annotations WHERE book_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([book_id], |r| {
        Ok(Annotation {
            id: r.get(0)?, book_id: r.get(1)?, format: r.get(2)?,
            location: r.get(3)?, text: r.get(4)?, note: r.get(5)?,
            color: r.get(6)?, created_at: r.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn delete_annotation(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}

pub fn add_bookmark(conn: &Connection, b: &NewBookmark) -> Result<i64> {
    conn.execute(
        "INSERT INTO bookmarks (book_id, location, label, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![b.book_id, b.location, b.label, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_bookmarks(conn: &Connection, book_id: i64) -> Result<Vec<Bookmark>> {
    let mut stmt = conn.prepare(
        "SELECT id, book_id, location, label, created_at FROM bookmarks WHERE book_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([book_id], |r| {
        Ok(Bookmark {
            id: r.get(0)?, book_id: r.get(1)?, location: r.get(2)?,
            label: r.get(3)?, created_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn delete_bookmark(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}
```

- [ ] **Step 4: 暴露库 crate**

修改 `src-tauri/Cargo.toml`：
```toml
[lib]
name = "yd_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```
把 db 模块挂到 `lib.rs`：
```rust
pub mod db;
```
运行 `cargo add --dev tempfile`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --test db_test`
Expected: 3 个测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/tests/db_test.rs
git commit -m "feat: SQLite 数据库层与测试"
```

---

### Task 3: 书籍导入 + Rust 命令层

**Files:**
- Create: `src-tauri/src/import.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`（注册命令、管理 AppState）
- Test: `src-tauri/tests/import_test.rs`

**Interfaces:**
- Consumes: `db::*` 全部函数（Task 2）
- Produces:
  - `pub struct AppState { pub db: Mutex<Connection>, pub app_data_dir: PathBuf }`
  - `pub fn import_books(files: Vec<String>, state: State<'_, AppState>) -> Result<Vec<Book>, String>` — 复制文件到 `books/`，解析标题/格式/封面，写入数据库
  - `pub fn list_books_cmd(state: State<'_, AppState>) -> Result<Vec<Book>, String>`
  - `pub fn remove_book(id: i64, state: State<'_, AppState>) -> Result<(), String>` — 删记录 + 删文件
  - `pub fn save_progress_cmd(book_id: i64, location: String, percent: f64, state: State<'_, AppState>) -> Result<(), String>`
  - `pub fn get_progress_cmd(book_id: i64, state: State<'_, AppState>) -> Result<Option<(String, f64)>, String>`
  - `pub fn list_annotations_cmd / add_annotation_cmd / delete_annotation_cmd`
  - `pub fn list_bookmarks_cmd / add_bookmark_cmd / delete_bookmark_cmd`
  - `pub fn get_setting_cmd / set_setting_cmd`
  - `pub fn books_dir(state: &AppState) -> PathBuf`

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/import_test.rs`：
```rust
use std::fs;
use tempfile::tempdir;
use yd_lib::import::import_file;
use yd_lib::db::init_db;

#[test]
fn import_copy_and_format_detect() {
    let dir = tempdir().unwrap();
    let src = dir.path().join("sample.txt");
    fs::write(&src, "这是一本测试书\n第二行").unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    let result = import_file(&src, &books_root).unwrap();
    assert_eq!(result.format, "txt");
    assert!(result.dest.exists());
    assert_eq!(fs::read_to_string(&result.dest).unwrap(), "这是一本测试书\n第二行");
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test import_test`
Expected: 编译失败（`import` 模块不存在）。

- [ ] **Step 3: 实现 import.rs**

```rust
use crate::db::{init_db, upsert_book, Book, NewBook};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
```

- [ ] **Step 4: 实现 commands.rs**

```rust
use crate::db::*;
use crate::import::{import_file, open_app_db};
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
    let conn = state.db.lock().unwrap();
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
        if let Ok(id) = upsert_book(&conn, &new_book) {
            let book = list_books(&conn)
                .unwrap_or_default()
                .into_iter()
                .find(|b| b.id == id);
            if let Some(b) = book {
                imported.push(b);
            }
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
pub fn set_setting_cmd(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    set_setting(&state.db.lock().unwrap(), &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting_cmd(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    get_setting(&state.db.lock().unwrap(), &key).map_err(|e| e.to_string())
}
```

- [ ] **Step 5: 在 lib.rs 组装**

```rust
pub mod db;
pub mod import;
pub mod commands;

use commands::*;
use tauri::Manager;

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
            import_books, list_books_cmd, remove_book,
            save_progress_cmd, get_progress_cmd,
            add_annotation_cmd, list_annotations_cmd, delete_annotation_cmd,
            add_bookmark_cmd, list_bookmarks_cmd, delete_bookmark_cmd,
            set_setting_cmd, get_setting_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
确保 `src-tauri/src/main.rs` 调用 `yd_lib::run()`。若 main.rs 原先内联逻辑，改为：
```rust
fn main() {
    yd_lib::run()
}
```

- [ ] **Step 6: 运行全部测试确认通过**

Run: `cargo test`
Expected: db_test + import_test 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/
git commit -m "feat: 书籍导入与 Rust 命令层"
```

---

### Task 4: 书架前端页面

**Files:**
- Create: `src/services/api.ts`
- Create: `src/pages/LibraryPage.tsx`
- Create: `src/components/BookCard.tsx`
- Create: `src/components/ImportButton.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Test: `src/pages/LibraryPage.test.tsx`

**Interfaces:**
- Consumes: `import_books`, `list_books_cmd`, `remove_book`（Task 3 的 Tauri 命令）
- Produces:
  - `src/services/api.ts`:
    - `export interface Book { id: number; title: string; format: string; path: string; cover_path: string | null; added_at: number; last_opened_at: number | null }`
    - `export function listBooks(): Promise<Book[]>`
    - `export function importFiles(): Promise<Book[]>` — 打开系统文件选择器并导入
    - `export function removeBook(id: number): Promise<void>`
  - `BookCard` props: `{ book: Book; onOpen: (book: Book) => void; onRemove: (id: number) => void }`
  - `LibraryPage` props: `{ onOpenBook: (book: Book) => void }`

- [ ] **Step 1: 写失败的测试**

`src/pages/LibraryPage.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import LibraryPage from "./LibraryPage";
import * as api from "../services/api";

const books = [
  { id: 1, title: "三体", format: "epub", path: "b1.epub", cover_path: null, added_at: 1, last_opened_at: null },
  { id: 2, title: "算法导论", format: "pdf", path: "b2.pdf", cover_path: null, added_at: 2, last_opened_at: null },
];

describe("LibraryPage", () => {
  it("renders book cards and empty state", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("算法导论")).toBeInTheDocument();
  });

  it("calls importFiles on import click", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    const spy = vi.spyOn(api, "importFiles").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("书架空空如也，点击导入书籍");
    await userEvent.click(screen.getByRole("button", { name: /导入书籍/ }));
    expect(spy).toHaveBeenCalled();
  });

  it("shows empty state when no books", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
  });
});
```
注意：测试依赖 `user-event`，先 `npm install -D @testing-library/user-event`。

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- --reporter=verbose`
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 实现 services/api.ts**

```ts
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  title: string;
  format: string;
  path: string;
  cover_path: string | null;
  added_at: number;
  last_opened_at: number | null;
}

export function coverUrl(path: string | null): string | undefined {
  return path ? convertFileSrc(path) : undefined;
}

export async function listBooks(): Promise<Book[]> {
  return invoke<Book[]>("list_books_cmd");
}

export async function importFiles(): Promise<Book[]> {
  const picked = await open({
    multiple: true,
    filters: [
      { name: "书籍", extensions: ["epub", "pdf", "md", "markdown", "txt"] },
    ],
  });
  if (!picked) return [];
  const files = Array.isArray(picked) ? picked : [picked];
  if (files.length === 0) return [];
  return invoke<Book[]>("import_books", { files });
}

export async function removeBook(id: number): Promise<void> {
  await invoke("remove_book", { id });
}

export async function saveProgress(bookId: number, location: string, percent: number): Promise<void> {
  await invoke("save_progress_cmd", { bookId, location, percent });
}

export async function getProgress(bookId: number): Promise<[string, number] | null> {
  return invoke<[string, number] | null>("get_progress_cmd", { bookId });
}

export async function listAnnotations(bookId: number) {
  return invoke<Array<{ id: number; book_id: number; format: string; location: string; text: string; note: string | null; color: string; created_at: number }>>("list_annotations_cmd", { bookId });
}

export async function addAnnotation(a: { bookId: number; format: string; location: string; text: string; note?: string; color: string }) {
  return invoke<number>("add_annotation_cmd", {
    bookId: a.bookId, format: a.format, location: a.location, text: a.text,
    note: a.note ?? null, color: a.color,
  });
}

export async function deleteAnnotation(id: number) {
  await invoke("delete_annotation_cmd", { id });
}

export async function listBookmarks(bookId: number) {
  return invoke<Array<{ id: number; book_id: number; location: string; label: string; created_at: number }>>("list_bookmarks_cmd", { bookId });
}

export async function addBookmark(b: { bookId: number; location: string; label: string }) {
  return invoke<number>("add_bookmark_cmd", { bookId: b.bookId, location: b.location, label: b.label });
}

export async function deleteBookmark(id: number) {
  await invoke("delete_bookmark_cmd", { id });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting_cmd", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  await invoke("set_setting_cmd", { key, value });
}
```

- [ ] **Step 4: 实现组件与页面**

`src/components/BookCard.tsx`：
```tsx
import type { Book } from "../services/api";
import { coverUrl } from "../services/api";

export function formatLabel(format: string) {
  return format.toUpperCase();
}

export default function BookCard({ book, onOpen, onRemove }: {
  book: Book; onOpen: (b: Book) => void; onRemove: (id: number) => void;
}) {
  return (
    <div className="book-card" onClick={() => onOpen(book)} role="button" tabIndex={0}>
      {book.cover_path ? (
        <img className="book-cover" src={coverUrl(book.cover_path)} alt={book.title} />
      ) : (
        <div className="book-cover book-cover-placeholder">
          <span>{formatLabel(book.format)}</span>
        </div>
      )}
      <div className="book-meta">
        <h3>{book.title}</h3>
        <span>{formatLabel(book.format)}</span>
      </div>
      <button
        className="book-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(book.id); }}
        aria-label={`删除 ${book.title}`}
      >×</button>
    </div>
  );
}
```

`src/components/ImportButton.tsx`：
```tsx
export default function ImportButton({ onImport, busy }: { onImport: () => void; busy: boolean }) {
  return (
    <button className="btn-primary" onClick={onImport} disabled={busy}>
      {busy ? "导入中…" : "导入书籍"}
    </button>
  );
}
```

`src/pages/LibraryPage.tsx`：
```tsx
import { useCallback, useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import ImportButton from "../components/ImportButton";
import { importFiles, listBooks, removeBook, type Book } from "../services/api";

export default function LibraryPage({ onOpenBook }: { onOpenBook: (b: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await importFiles();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: number) => {
    if (!window.confirm("确定删除这本书吗？")) return;
    try {
      await removeBook(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="library">
      <header className="library-header">
        <h1>阅卷</h1>
        <ImportButton onImport={handleImport} busy={busy} />
      </header>
      {error && <p className="error">{error}</p>}
      {books.length === 0 ? (
        <p className="empty">书架空空如也，点击「导入书籍」开始阅读</p>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <BookCard key={b.id} book={b} onOpen={onOpenBook} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/App.tsx`（简化路由：state 切换书架/阅读/设置）：
```tsx
import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import type { Book } from "./services/api";
import "./App.css";

type View =
  | { name: "library" }
  | { name: "reader"; book: Book }
  | { name: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });

  if (view.name === "reader") {
    return <ReaderPage book={view.book} onBack={() => setView({ name: "library" })} />;
  }
  if (view.name === "settings") {
    return <SettingsPage onBack={() => setView({ name: "library" })} />;
  }
  return (
    <div>
      <LibraryPage onOpenBook={(book) => setView({ name: "reader", book })} />
      <button className="btn-secondary" onClick={() => setView({ name: "settings" })}>设置</button>
    </div>
  );
}
```
注：`ReaderPage` 与 `SettingsPage` 在 Task 6/7/11 创建，本任务先创建 `src/pages/ReaderPage.tsx` 与 `src/pages/SettingsPage.tsx` 的最小占位（真实渲染后续任务补全），保证 App.tsx 可编译：
```tsx
export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  return <div><button onClick={onBack}>返回</button><h2>{book.title}</h2></div>;
}
```
```tsx
export default function SettingsPage({ onBack }: { onBack: () => void }) {
  return <div><button onClick={onBack}>返回</button><h2>设置</h2></div>;
}
```

- [ ] **Step 5: 添加样式**

`src/App.css` 追加（网格、卡片、占位封面、按钮、空态样式）：
```css
.library-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; }
.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 0 24px 40px; }
.book-card { position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.book-cover { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
.book-cover-placeholder { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #5b8def, #7c5bde); color: #fff; font-size: 28px; font-weight: 700; }
.book-meta { padding: 8px 10px; }
.book-meta h3 { margin: 0 0 4px; font-size: 14px; }
.book-meta span { color: #888; font-size: 12px; }
.book-remove { position: absolute; top: 4px; right: 4px; border: none; background: rgba(0,0,0,.5); color: #fff; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; }
.empty { text-align: center; color: #999; margin-top: 80px; }
.error { color: #d33; padding: 0 24px; }
.btn-primary { padding: 8px 18px; border: none; border-radius: 6px; background: #2f6fed; color: #fff; cursor: pointer; }
.btn-primary:disabled { opacity: .5; }
.btn-secondary { padding: 8px 18px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; margin: 16px 24px; }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test`
Expected: LibraryPage 3 个用例 PASS。

- [ ] **Step 7: 运行 tauri dev 冒烟**

Run: `npm run tauri dev`
Expected: 启动后显示「阅卷」标题、「导入书籍」按钮、「设置」按钮、空书架提示。点击导入选择 txt 文件后书架出现卡片。
注意：若 `tauri dev` 首次编译 Rust 较慢（数分钟）属正常。

- [ ] **Step 8: 提交**

```bash
git add src/
git commit -m "feat: 书架页面与书籍导入前端"
```

---

### Task 5: EPUB/MD/TXT 阅读器（webview 渲染 + 进度保存）

**Files:**
- Create: `src/readers/useReaderProgress.ts`
- Create: `src/readers/EpubReader.tsx`
- Create: `src/readers/MdReader.tsx`
- Create: `src/readers/TxtReader.tsx`
- Create: `src/readers/common.ts`
- Modify: `src/pages/ReaderPage.tsx`（按格式分流）
- Modify: `src/services/api.ts`（`readFileContent`）
- Modify: `src-tauri/src/commands.rs`（`read_file_content`）
- Test: `src/readers/useReaderProgress.test.ts`

**Interfaces:**
- Consumes: `save_progress_cmd` / `get_progress_cmd`（Task 3）
- Produces:
  - `useReaderProgress(bookId: number, saveIntervalMs?: number): { location: string | null; percent: number; loaded: boolean; save(loc: string, pct: number): Promise<void> }`
  - `readFileContent(path: string): Promise<string>` — Rust 读文本文件（UTF-8 / GBK 兜底）
  - `ReaderPage` 路由：`format === "epub"` → EpubReader；`"md"` → MdReader；`"txt"` → TxtReader；`"pdf"` → PdfReader（Task 6）
  - epub.js 使用：`import ePub from "epubjs"; import "epubjs/dist/epub.min.css";` 容器 `ref`，`book.renderTo(el, { width, height, flow: "paginated" })`，`rendition.display(cfi)`，进度取 `rendition.currentLocation().start.cfi` 与 `rendition.book.locations.percentageFromCfi(cfi)`

- [ ] **Step 1: 写失败的测试**

`src/readers/useReaderProgress.test.ts`：
```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReaderProgress } from "./useReaderProgress";
import * as api from "../services/api";

describe("useReaderProgress", () => {
  it("loads saved progress on mount", async () => {
    vi.spyOn(api, "getProgress").mockResolvedValue(["cfi-1", 0.5]);
    const { result } = renderHook(() => useReaderProgress(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.location).toBe("cfi-1");
    expect(result.current.percent).toBe(0.5);
  });

  it("saves progress through api", async () => {
    vi.spyOn(api, "getProgress").mockResolvedValue(null);
    const spy = vi.spyOn(api, "saveProgress").mockResolvedValue();
    const { result } = renderHook(() => useReaderProgress(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.save("cfi-9", 0.9); });
    expect(spy).toHaveBeenCalledWith(7, "cfi-9", 0.9);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: Rust 新增读文件命令**

`src-tauri/src/commands.rs` 追加：
```rust
#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let text = String::from_utf8(bytes.clone()).unwrap_or_else(|_| {
        String::from_utf8_lossy(&bytes).into_owned()
    });
    Ok(text)
}
```
在 `lib.rs` 的 `generate_handler!` 中加入 `read_file_content`。

- [ ] **Step 4: 实现 useReaderProgress.ts**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getProgress, saveProgress } from "../services/api";

export function useReaderProgress(bookId: number, saveIntervalMs = 3000) {
  const [location, setLocation] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<{ loc: string; pct: number } | null>(null);
  const latest = useRef<{ loc: string; pct: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await getProgress(bookId);
        if (!cancelled && saved) {
          setLocation(saved[0]);
          setPercent(saved[1]);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const save = useCallback(async (loc: string, pct: number) => {
    latest.current = { loc, pct };
    await saveProgress(bookId, loc, pct);
  }, [bookId]);

  const flush = useCallback(async () => {
    if (pending.current) {
      await saveProgress(bookId, pending.current.loc, pending.current.pct);
      pending.current = null;
    }
  }, [bookId]);

  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, saveIntervalMs);
    const onUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush, saveIntervalMs]);

  const saveDebounced = useCallback((loc: string, pct: number) => {
    setLocation(loc);
    setPercent(pct);
    pending.current = { loc, pct };
  }, []);

  return { location, percent, loaded, save, saveDebounced };
}
```

- [ ] **Step 5: api.ts 追加 readFileContent**

```ts
export async function readFileContent(path: string): Promise<string> {
  return invoke<string>("read_file_content", { path });
}
```

- [ ] **Step 6: 实现 common.ts 与三个阅读器**

`src/readers/common.ts`：
```ts
import { useEffect } from "react";
import { useReaderProgress } from "./useReaderProgress";

export function useSaveOnLocationChange(
  bookId: number,
  location: string | null,
  percent: number,
  save: (loc: string, pct: number) => Promise<void>,
) {
  useEffect(() => {
    if (location == null) return;
    const t = setTimeout(() => { void save(location, percent); }, 800);
    return () => clearTimeout(t);
  }, [location, percent, save, bookId]);
}
```

`src/readers/EpubReader.tsx`：
```tsx
import { useEffect, useRef } from "react";
import ePub, { Book as EpubBook, Rendition } from "epubjs";
import "epubjs/dist/epub.min.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useSaveOnLocationChange } from "./common";

export default function EpubReader({ path, bookId }: { path: string; bookId: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  const saveDebouncedRef = useRef(saveDebounced);
  saveDebouncedRef.current = saveDebounced;
  useSaveOnLocationChange(bookId, location, percent, save);

  useEffect(() => {
    if (!hostRef.current) return;
    const book = ePub(convertFileSrc(path));
    bookRef.current = book;
    const rendition = book.renderTo(hostRef.current, { flow: "paginated", width: "100%", height: "100%" });
    renditionRef.current = rendition;
    rendition.on("relocated", (locationObj: any) => {
      const start = locationObj.start?.cfi;
      if (!start) return;
      (window as any).__readerLocation = start;
      let pct = 0;
      try { pct = rendition.book.locations.percentageFromCfi(start); } catch { /* ignore */ }
      saveDebouncedRef.current(start, pct);
    });
    void (async () => {
      await rendition.book.locations.generate(1600).catch(() => {});
      if (loaded && location) {
        await rendition.display(location);
      } else {
        await rendition.display();
      }
    })();
    return () => {
      rendition.destroy();
      book.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded]);

  return <div className="reader-host" ref={hostRef} />;
}
```
> 说明：`rendition.book.locations.generate(1600)` 先生成章节位置表，`percentageFromCfi` 才能返回有效百分比。`relocated` 回调里把当前 CFI 写入 `window.__readerLocation`，供标注/书签面板读取当前位置。

`src/readers/MdReader.tsx`：
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { useReaderProgress } from "./useReaderProgress";
import { useSaveOnLocationChange } from "./common";
import { readFileContent } from "../services/api";

export default function MdReader({ path, bookId }: { path: string; bookId: number }) {
  const [html, setHtml] = useState("");
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await readFileContent(path);
      if (!cancelled) setHtml(marked.parse(text) as string);
    })();
    return () => { cancelled = true; };
  }, [path]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
    saveDebounced(String(Math.round((pct + Number.EPSILON) * 1000) / 1000), pct);
  };

  const initialScroll = useMemo(() => {
    if (loaded && location) {
      const pct = parseFloat(location);
      return Number.isFinite(pct) ? pct : 0;
    }
    return 0;
  }, [loaded, location]);

  useEffect(() => {
    const el = containerRef.current;
    if (el && loaded && location != null && Number.isFinite(parseFloat(location))) {
      el.scrollTop = parseFloat(location) * (el.scrollHeight - el.clientHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, html]);

  return (
    <div className="md-reader" ref={containerRef} onScroll={onScroll}>
      <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
```

`src/readers/TxtReader.tsx`：
```tsx
import { useEffect, useMemo, useState } from "react";
import { useReaderProgress } from "./useReaderProgress";
import { useSaveOnLocationChange } from "./common";
import { readFileContent } from "../services/api";

const LINES_PER_PAGE = 40;

export default function TxtReader({ path, bookId }: { path: string; bookId: number }) {
  const [lines, setLines] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const { location, percent, loaded, save } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await readFileContent(path);
      if (!cancelled) setLines(text.split(/\r?\n/));
    })();
    return () => { cancelled = true; };
  }, [path]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE)), [lines]);

  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 0 && p < pageCount) setPage(p);
    }
  }, [loaded, location, pageCount]);

  const go = (p: number) => {
    const clamped = Math.min(Math.max(0, p), pageCount - 1);
    setPage(clamped);
    save(String(clamped), clamped / pageCount);
  };

  return (
    <div className="txt-reader">
      <div className="txt-page" key={page}>
        {lines.slice(page * LINES_PER_PAGE, (page + 1) * LINES_PER_PAGE).map((l, i) => (
          <p key={i}>{l || "\u00A0"}</p>
        ))}
      </div>
      <div className="txt-nav">
        <button onClick={() => go(page - 1)} disabled={page === 0}>上一页</button>
        <span>{page + 1} / {pageCount}</span>
        <button onClick={() => go(page + 1)} disabled={page >= pageCount - 1}>下一页</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 分流 ReaderPage**

`src/pages/ReaderPage.tsx`：
```tsx
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import type { Book } from "../services/api";
import "./ReaderPage.css";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  return (
    <div className="reader-page">
      <header className="reader-toolbar">
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
        <h2>{book.title}</h2>
      </header>
      <main className="reader-main">
        {book.format === "epub" && <EpubReader path={book.path} bookId={book.id} />}
        {book.format === "pdf" && <PdfReader path={book.path} bookId={book.id} />}
        {book.format === "md" && <MdReader path={book.path} bookId={book.id} />}
        {book.format === "txt" && <TxtReader path={book.path} bookId={book.id} />}
      </main>
    </div>
  );
}
```
`src/pages/ReaderPage.css`：
```css
.reader-page { display: flex; flex-direction: column; height: 100vh; }
.reader-toolbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 1px solid #e5e5e5; }
.reader-toolbar h2 { margin: 0; font-size: 16px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-main { flex: 1; overflow: hidden; }
.reader-host { width: 100%; height: 100%; }
.md-reader { height: 100%; overflow-y: auto; padding: 24px; box-sizing: border-box; }
.md-content { max-width: 720px; margin: 0 auto; line-height: 1.8; }
.txt-reader { height: 100%; display: flex; flex-direction: column; }
.txt-page { flex: 1; overflow-y: auto; padding: 32px; line-height: 1.9; }
.txt-nav { display: flex; justify-content: center; align-items: center; gap: 16px; padding: 8px; }
```
注：`PdfReader` 在 Task 6 创建；本任务先创建占位 `src/readers/PdfReader.tsx`：
```tsx
export default function PdfReader(_: { path: string; bookId: number }) {
  return <div className="pdf-placeholder">PDF 渲染器将在下一步实现</div>;
}
```

- [ ] **Step 8: 运行前端测试**

Run: `npm test`
Expected: 全部 PASS（含 useReaderProgress 2 个新用例）。

- [ ] **Step 9: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 导入一本 TXT，打开后翻页、进度保存；刷新重开后恢复到上次页码。
```bash
git add src/ src-tauri/src/
git commit -m "feat: EPUB/MD/TXT 阅读器与进度保存恢复"
```

---

### Task 6: PDF 阅读器（pdf.js）

**Files:**
- Create: `src/readers/PdfReader.tsx`（替换占位）
- Modify: `src/pages/ReaderPage.css`（PDF 工具条样式）
- Test: `src/readers/PdfReader.test.tsx`（仅测组件挂载与工具栏渲染，pdf.js 在 jsdom 下 stub）

**Interfaces:**
- Consumes: `readFileContent`（不需要；PDF 用二进制，前端直接用 path 传给 pdf.js）；`useReaderProgress`
- Produces: `PdfReader({ path, bookId })` 完成组件：加载 PDF、渲染当前页 canvas、翻页、缩放、进度保存（页码 + percent）

- [ ] **Step 1: 写失败的测试**

`src/readers/PdfReader.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PdfReader from "./PdfReader";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 3 }) }),
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs", () => ({}));

describe("PdfReader", () => {
  it("renders toolbar with page nav", () => {
    render(<PdfReader path="/b.pdf" bookId={1} />);
    expect(screen.getByText(/上一页/)).toBeInTheDocument();
    expect(screen.getByText(/下一页/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- PdfReader`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 安装 pdf.js worker 依赖**

Run: `npm install pdfjs-dist@4.10.38`（固定大版本；若最新版 worker 路径不同，按该版本文档调整 workerSrc 指向 `node_modules/pdfjs-dist/build/pdf.worker.mjs`）。将 worker 复制到 `public/`：
```bash
Copy-Item node_modules/pdfjs-dist/build/pdf.worker.mjs public/pdf.worker.mjs
```
若 `public/` 不存在则先创建。

- [ ] **Step 4: 实现 PdfReader.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useSaveOnLocationChange } from "./common";

GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

export default function PdfReader({ path, bookId }: { path: string; bookId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const { location, percent, loaded, save } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 1) setPage(p);
    }
  }, [loaded, location]);

  const renderPage = async (pageNum: number, scale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pdf = await getDocument(convertFileSrc(path)).promise;
    const p = await pdf.getPage(pageNum);
    const viewport = p.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await p.render({ canvasContext: ctx, viewport }).promise;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdf = await getDocument(convertFileSrc(path)).promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);
        await renderPage(pageRef.current, zoom);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded]);

  useEffect(() => {
    void renderPage(page, zoom).catch((e) => setError(String(e)));
    save(String(page), page / Math.max(1, numPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, numPages]);

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
        <span>{numPages ? `${page} / ${numPages}` : "加载中…"}</span>
        <button className="btn-secondary" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>下一页</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => +(z - 0.2).toFixed(2))}>缩小</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => +(z + 0.2).toFixed(2))}>放大</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="pdf-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
```
`src/pages/ReaderPage.css` 追加：
```css
.pdf-reader { height: 100%; display: flex; flex-direction: column; }
.pdf-toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid #eee; }
.pdf-canvas-wrap { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 16px; }
.pdf-canvas-wrap canvas { box-shadow: 0 2px 12px rgba(0,0,0,.15); }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- PdfReader`
Expected: PASS。

- [ ] **Step 6: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 打开 PDF 正常渲染首页，翻页/缩放可用，进度记录页码。
```bash
git add src/
git commit -m "feat: PDF 阅读器（pdf.js）"
```

---

### Task 7: 标注与书签前端

**Files:**
- Create: `src/components/AnnotationPanel.tsx`
- Create: `src/components/BookmarkPanel.tsx`
- Create: `src/readers/epubAnnotation.ts`（epub.js 高亮工具）
- Modify: `src/pages/ReaderPage.tsx`（面板 + 快捷键）
- Modify: `src/pages/ReaderPage.css`
- Test: `src/components/AnnotationPanel.test.tsx`

**Interfaces:**
- Consumes: `list_annotations_cmd`, `add_annotation_cmd`, `delete_annotation_cmd`, `list_bookmarks_cmd`, `add_bookmark_cmd`, `delete_bookmark_cmd`（Task 3 命令，api.ts 已封装）
- Produces:
  - `AnnotationPanel({ bookId, format, onJump, onChanged })` — 列表 + 新建 + 删除
  - `BookmarkPanel({ bookId, onJump, onChanged })` — 列表 + 删除
  - epub 高亮：在 EpubReader 内使用 epub.js `rendition.annotations.add(type, cfi, { cfi, text, color, ... })` 与 `rendition.annotations.remove(cfi, type)`

- [ ] **Step 1: 写失败的测试**

`src/components/AnnotationPanel.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnotationPanel from "./AnnotationPanel";
import * as api from "../services/api";

const anns = [
  { id: 1, book_id: 1, format: "epub", location: "cfi1", text: "高亮A", note: null, color: "yellow", created_at: 1 },
];

describe("AnnotationPanel", () => {
  it("renders existing annotations", async () => {
    vi.spyOn(api, "listAnnotations").mockResolvedValue(anns);
    render(<AnnotationPanel bookId={1} format="epub" onJump={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("高亮A")).toBeInTheDocument();
  });

  it("adds an annotation via form", async () => {
    vi.spyOn(api, "listAnnotations").mockResolvedValue([]);
    const addSpy = vi.spyOn(api, "addAnnotation").mockResolvedValue(9);
    render(<AnnotationPanel bookId={1} format="epub" onJump={() => {}} onChanged={() => {}} />);
    await screen.findByText(/暂无标注/);
    await userEvent.type(screen.getByLabelText("标注文本"), "新的高亮");
    await userEvent.click(screen.getByRole("button", { name: /添加标注/ }));
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- AnnotationPanel`
Expected: FAIL。

- [ ] **Step 3: 实现面板组件**

`src/components/AnnotationPanel.tsx`：
```tsx
import { useCallback, useEffect, useState } from "react";
import { addAnnotation, deleteAnnotation, listAnnotations } from "../services/api";

export interface AnnotationItem {
  id: number; book_id: number; format: string; location: string;
  text: string; note: string | null; color: string; created_at: number;
}

export default function AnnotationPanel({ bookId, onJump, onChanged }: {
  bookId: number; onJump: (loc: string) => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [text, setText] = useState("");
  const [color, setColor] = useState("yellow");

  const refresh = useCallback(async () => {
    setItems((await listAnnotations(bookId)) as AnnotationItem[]);
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!text.trim()) return;
    await addAnnotation({ bookId, format: "manual", location: locationHref(), text, color });
    setText("");
    await refresh();
    onChanged();
  };

  function locationHref(): string {
    const w = window as any;
    return w.__readerLocation ?? "";
  }

  const handleDelete = async (id: number) => {
    await deleteAnnotation(id);
    await refresh();
    onChanged();
  };

  return (
    <aside className="panel">
      <h3>标注</h3>
      {items.length === 0 ? <p className="panel-empty">暂无标注</p> : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className={`annotation annotation-${a.color}`}>
              <p onClick={() => onJump(a.location)}>{a.text}</p>
              <button onClick={() => handleDelete(a.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-add">
        <input aria-label="标注文本" value={text} onChange={(e) => setText(e.target.value)} placeholder="标注内容" />
        <select aria-label="颜色" value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="yellow">黄</option>
          <option value="green">绿</option>
          <option value="blue">蓝</option>
          <option value="pink">粉</option>
        </select>
        <button className="btn-primary" onClick={handleAdd} disabled={!text.trim()}>添加标注</button>
      </div>
    </aside>
  );
}
```

`src/components/BookmarkPanel.tsx`：
```tsx
import { useCallback, useEffect, useState } from "react";
import { addBookmark, deleteBookmark, listBookmarks } from "../services/api";

export interface BookmarkItem {
  id: number; book_id: number; location: string; label: string; created_at: number;
}

export default function BookmarkPanel({ bookId, onJump, onChanged }: {
  bookId: number; onJump: (loc: string) => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const refresh = useCallback(async () => {
    setItems((await listBookmarks(bookId)) as BookmarkItem[]);
  }, [bookId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    const w = window as any;
    const loc = w.__readerLocation ?? "";
    if (!loc) return;
    await addBookmark({ bookId, location: loc, label: `书签 ${items.length + 1}` });
    await refresh();
    onChanged();
  };

  const handleDelete = async (id: number) => {
    await deleteBookmark(id);
    await refresh();
    onChanged();
  };

  return (
    <aside className="panel">
      <h3>书签</h3>
      <button className="btn-primary" onClick={handleAdd}>添加当前书签</button>
      {items.length === 0 ? <p className="panel-empty">暂无书签</p> : (
        <ul>
          {items.map((b) => (
            <li key={b.id}>
              <p onClick={() => onJump(b.location)}>{b.label}</p>
              <button onClick={() => handleDelete(b.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: 集成进 ReaderPage**

`src/pages/ReaderPage.tsx`（改造为带工具栏与侧栏）：
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import AnnotationPanel from "../components/AnnotationPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import type { Book } from "../services/api";
import "./ReaderPage.css";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  const [panel, setPanel] = useState<"annotations" | "bookmarks" | null>(null);
  const jumpKey = useRef(0);

  const jump = useCallback((loc: string) => {
    const w = window as any;
    w.__jumpTo = loc;
    jumpKey.current += 1;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const w = window as any;
        const loc = w.__readerLocation ?? "";
        if (loc) w.__requestBookmark?.();
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPanel((p) => (p === "annotations" ? null : "annotations"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="reader-page">
      <header className="reader-toolbar">
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
        <h2>{book.title}</h2>
        <button className="btn-secondary" onClick={() => setPanel((p) => (p === "annotations" ? null : "annotations"))}>标注</button>
        <button className="btn-secondary" onClick={() => setPanel((p) => (p === "bookmarks" ? null : "bookmarks"))}>书签</button>
      </header>
      <div className="reader-body">
        <main className="reader-main">
          {book.format === "epub" && <EpubReader path={book.path} bookId={book.id} />}
          {book.format === "pdf" && <PdfReader path={book.path} bookId={book.id} />}
          {book.format === "md" && <MdReader path={book.path} bookId={book.id} />}
          {book.format === "txt" && <TxtReader path={book.path} bookId={book.id} />}
        </main>
        {panel === "annotations" && (
          <AnnotationPanel bookId={book.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
        {panel === "bookmarks" && (
          <BookmarkPanel bookId={book.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
      </div>
    </div>
  );
}
```
`src/pages/ReaderPage.css` 追加：
```css
.reader-body { flex: 1; display: flex; min-height: 0; }
.reader-main { flex: 1; min-width: 0; overflow: hidden; }
.panel { width: 280px; border-left: 1px solid #eee; padding: 12px; overflow-y: auto; background: #fafafa; }
.panel ul { list-style: none; margin: 0; padding: 0; }
.panel li { padding: 8px; border-radius: 6px; background: #fff; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.panel li p { cursor: pointer; margin: 0 0 6px; }
.panel-add { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.panel-add input, .panel-add select { padding: 6px; }
.panel-empty { color: #999; }
.annotation-yellow { border-left: 4px solid #f5c518; }
.annotation-green { border-left: 4px solid #34a853; }
.annotation-blue { border-left: 4px solid #4285f4; }
.annotation-pink { border-left: 4px solid #ea7cbb; }
```

- [ ] **Step 5: EpubReader 集成标注/书签事件**

`src/readers/EpubReader.tsx` 中新增：在 `useEffect` 内注册
```ts
const w = window as any;
w.__requestBookmark = () => {
  const loc = rendition.currentLocation()?.start?.cfi;
  if (!loc) return;
  w.__bookmarkLocation = loc;
  w.dispatchEvent(new CustomEvent("request-bookmark", { detail: loc }));
};
```
ReaderPage 监听 `request-bookmark` 事件来调用书签添加（简化：BookmarkPanel 读取 `window.__bookmarkLocation`）。本任务以「面板列表 + 添加/删除」为主，epub 内文本高亮的完整实现放入 Task 8。

- [ ] **Step 6: 运行测试**

Run: `npm test -- AnnotationPanel`
Expected: PASS。

- [ ] **Step 7: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 打开 EPUB，可添加标注与书签，面板展示并可跳转/删除。
```bash
git add src/
git commit -m "feat: 标注与书签面板"
```

---

### Task 8: EPUB 文本高亮（标注渲染到阅读器）

**Files:**
- Modify: `src/readers/EpubReader.tsx`（加载已有标注并渲染高亮；选中文本创建高亮）
- Modify: `src/readers/epubAnnotation.ts`（新建）
- Test: `src/readers/epubAnnotation.test.ts`

**Interfaces:**
- Consumes: `list_annotations_cmd` / `add_annotation_cmd` / `delete_annotation_cmd`；epub.js Rendition.annotations API
- Produces:
  - `applyAnnotations(rendition, annotations, onRemoveCfi): Promise<void>` — 渲染所有高亮
  - `installSelectionHandler(rendition, onHighlight(text, cfiRange, color))` — 选中文本监听
  - `removeHighlight(rendition, cfi)` — 移除高亮

- [ ] **Step 1: 写失败的测试**

`src/readers/epubAnnotation.test.ts`：
```ts
import { describe, it, expect, vi } from "vitest";
import { installSelectionHandler, applyAnnotations } from "./epubAnnotation";

function fakeRendition() {
  const annotations = { add: vi.fn(), remove: vi.fn(), highlight: vi.fn() };
  return {
    annotations,
    on: vi.fn(),
    getContents: vi.fn(() => []),
  };
}

describe("epubAnnotation", () => {
  it("applies stored annotations as highlights", () => {
    const r = fakeRendition();
    const anns = [{ location: "cfiA", text: "x", color: "yellow" }] as any;
    applyAnnotations(r as any, anns);
    expect(r.annotations.highlight).toHaveBeenCalledWith("cfiA", {}, expect.any(Function), "yellow", { text: "x" });
  });

  it("installs mouseup selection handler", () => {
    const r = fakeRendition();
    installSelectionHandler(r as any, () => {});
    expect(r.on).toHaveBeenCalledWith("selected", expect.any(Function));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- epubAnnotation`
Expected: FAIL。

- [ ] **Step 3: 实现 epubAnnotation.ts**

```ts
import type { Rendition } from "epubjs";

export interface StoredAnnotation {
  location: string;
  text: string;
  color: string;
  id: number;
}

export function applyAnnotations(
  rendition: Rendition,
  annotations: StoredAnnotation[],
  onRemove?: (id: number) => void,
) {
  for (const a of annotations) {
    rendition.annotations.highlight(
      a.location,
      {},
      (event: any, cfi: string, contents: any) => {
        if (onRemove && event.target) {
          onRemove(a.id);
          rendition.annotations.remove(cfi, "highlight");
        }
      },
      a.color,
      { text: a.text },
    );
  }
}

export function installSelectionHandler(
  rendition: Rendition,
  onHighlight: (text: string, cfiRange: string) => void,
) {
  rendition.on("selected", (cfiRange: string, contents: any) => {
    const text = contents.window.getSelection?.()?.toString?.() ?? "";
    if (text.trim()) onHighlight(text.trim(), cfiRange);
  });
}

export function removeHighlight(rendition: Rendition, cfi: string) {
  rendition.annotations.remove(cfi, "highlight");
}
```

- [ ] **Step 4: 集成进 EpubReader**

在 `src/readers/EpubReader.tsx` 的 rendition 初始化后：
```tsx
const [annotations, setAnnotations] = useState<StoredAnnotation[]>([]);

useEffect(() => {
  let cancelled = false;
  (async () => {
    const list = (await listAnnotations(bookId)) as any[];
    if (!cancelled) {
      setAnnotations(list.map((a) => ({ id: a.id, location: a.location, text: a.text, color: a.color })));
    }
  })();
  return () => { cancelled = true; };
}, [bookId]);
```
在渲染前 applyAnnotations（依赖 rendition 就绪）：
```tsx
useEffect(() => {
  if (!renditionRef.current) return;
  applyAnnotations(renditionRef.current, annotations, (id) => {
    void deleteAnnotation(id);
  });
}, [annotations]);
```
并挂载选区监听（仅 EPUB 文本选中时，显示浮动「高亮」按钮或直接创建高亮）：
```tsx
useEffect(() => {
  const r = renditionRef.current;
  if (!r) return;
  installSelectionHandler(r, async (text, cfiRange) => {
    await addAnnotation({ bookId, format: "epub", location: cfiRange, text, color: "yellow" });
    setAnnotations((prev) => [...prev, { id: -Date.now(), location: cfiRange, text, color: "yellow" }]);
  });
}, [bookId]);
```
说明：选中即自动创建黄色高亮（MVP 交互）。删除高亮点击时触发 `onRemove` → 调 `deleteAnnotation` 并重新加载标注。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- epubAnnotation`
Expected: PASS。

- [ ] **Step 6: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: EPUB 中选中文字后出现黄色高亮并保存；重启后高亮仍显示；点击高亮可删除。
```bash
git add src/
git commit -m "feat: EPUB 文本高亮标注"
```

---

### Task 9: 全文搜索（tantivy 索引 + 搜索命令 + 前端）

**Files:**
- Create: `src-tauri/src/search.rs`
- Modify: `src-tauri/src/commands.rs`（`search_books`, `reindex`）
- Modify: `src-tauri/src/lib.rs`
- Create: `src/components/SearchPanel.tsx`
- Modify: `src/pages/LibraryPage.tsx`（搜索入口）
- Modify: `src/pages/ReaderPage.tsx`（跳转处理：窗口事件 `search-jump`）
- Test: `src-tauri/tests/search_test.rs`

**Interfaces:**
- Consumes: `list_books`（Task 2）
- Produces:
  - `pub fn build_index(app_data_dir: &Path, conn: &Connection) -> Result<(), String>` — 遍历书籍提取文本写 tantivy 索引
  - `pub fn search(app_data_dir: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String>`
  - `pub struct SearchHit { pub book_id: u64, pub title: String, pub format: String, pub text: String, pub location: String }`
  - `#[tauri::command] pub fn search_books(query: String, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String>`
  - `#[tauri::command] pub fn reindex(state: State<'_, AppState>) -> Result<(), String>`

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/search_test.rs`：
```rust
use std::fs;
use tempfile::tempdir;
use yd_lib::db::init_db;
use yd_lib::db::{upsert_book, NewBook};
use yd_lib::search::{build_index, search};

#[test]
fn index_and_search() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    fs::write(books_root.join("a.txt"), "云上的日子十分漫长").unwrap();
    let id = upsert_book(&conn, &NewBook {
        title: "甲".into(), format: "txt".into(),
        path: books_root.join("a.txt").to_string_lossy().into_owned(),
        cover_path: None,
    }).unwrap();
    build_index(dir.path(), &conn).unwrap();
    let hits = search(dir.path(), "漫长", 10).unwrap();
    assert!(!hits.is_empty());
    assert_eq!(hits[0].book_id, id as u64);
    assert!(hits[0].text.contains("漫长"));
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test search_test`
Expected: 编译失败（模块不存在）。

- [ ] **Step 3: 实现 search.rs**

```rust
use crate::db::list_books;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, IndexRecordOption, Schema, TextOptions, TEXT};
use tantivy::{doc, Index};

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
        .set_indexing_options(IndexRecordOption::WithFreqsAndPositions);
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
        Err(_) => String::new(),
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
    let (schema, id_f, title_f, text_f) = schema();
    let index = Index::create_in_dir(&index_dir, schema).map_err(|e| e.to_string())?;
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

pub fn search(app_data_dir: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let index_dir = app_data_dir.join("index");
    let (schema, id_f, title_f, text_f) = schema();
    let index = Index::open_in_dir(&index_dir).map_err(|e| format!("索引未就绪: {e}"))?;
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&index, vec![title_f, text_f]);
    let query = parser.parse_query(query).map_err(|e| format!("查询语法错误: {e}"))?;
    let top = searcher.search(&query, &TopDocs::with_limit(limit)).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for (_score, doc_address) in top {
        let retrieved = searcher.doc(doc_address).map_err(|e| e.to_string())?;
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
```
> 依赖：先执行 `cargo add zip pdf-extract`（pdf-extract 可能拉取较多依赖；若编译过慢或失败，`extract_pdf_text` 可退化为返回空串并记录 warning，PDF 搜索暂缺，功能在 Task 9 末尾标注）。`format` 与 `location` 在搜索时可由 book_id 反查，本任务先用 `String::new()` 占位，前端用 title+text 展示即可。

`commands.rs` 追加：
```rust
#[tauri::command]
pub fn search_books(query: String, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    crate::search::search(&state.app_data_dir, &query, 100)
}

#[tauri::command]
pub fn reindex(state: State<'_, AppState>) -> Result<(), String> {
    crate::search::build_index(&state.app_data_dir, &state.db.lock().unwrap())
}
```
`lib.rs` 加 `pub mod search;` 并把两个命令注册进 `generate_handler!`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --test search_test`
Expected: PASS。

- [ ] **Step 5: 前端 SearchPanel**

`src/components/SearchPanel.tsx`：
```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SearchHit {
  book_id: number; title: string; format: string; text: string; location: string;
}

export default function SearchPanel({ onJump }: { onJump: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await invoke<SearchHit[]>("search_books", { query }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel search-panel">
      <h3>全文搜索</h3>
      <div className="panel-add">
        <input aria-label="搜索关键词" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()} placeholder="搜索书名与正文" />
        <button className="btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      <ul>
        {results.map((h, i) => (
          <li key={i}>
            <p className="hit-title" onClick={() => onJump(h)}>{h.title}</p>
            <p className="hit-text">{h.text.slice(0, 120)}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```
LibraryPage 添加搜索按钮（顶部），点击在书架下方显示 SearchPanel；`onJump` 跳转处理：若命中书籍未打开则打开该书籍并派发 `search-jump` 事件，ReaderPage 接收后跳转到位置（PDF/MD/TXT 用 location=文本片段作关键字：ReaderPage 在渲染后 `window.find` 定位；EPUB 因 location 为空跳转到开头）。这是已知简化，记录在 `docs/superpowers/specs` 的已知限制中。

`src/pages/LibraryPage.tsx` 顶部工具栏加：
```tsx
const [showSearch, setShowSearch] = useState(false);
// 在 header 里加按钮：<button className="btn-secondary" onClick={() => setShowSearch(s => !s)}>全文搜索</button>
// 在 header 下方：{showSearch && <SearchPanel onJump={(h) => { setView({ name: "reader", book: h as any }); }} />}
```

- [ ] **Step 6: 运行前端与 Rust 全部测试**

Run: `npm test && cargo test`
Expected: 全部 PASS。

- [ ] **Step 7: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 导入含特定词的 TXT，书架点「全文搜索」输入词，结果出现，点击跳转打开书籍。
```bash
git add src/ src-tauri/
git commit -m "feat: tantivy 全文搜索"
```

---

### Task 10: TTS 朗读

**Files:**
- Create: `src-tauri/src/tts.rs`
- Modify: `src-tauri/src/commands.rs`（`tts_speak`, `tts_stop`, `tts_set_rate`, `tts_list_voices`）
- Modify: `src-tauri/src/lib.rs`
- Create: `src/components/TtsBar.tsx`
- Modify: `src/pages/ReaderPage.tsx`
- Test: `src-tauri/tests/tts_test.rs`（仅测试设置语速/错误分支；实际朗读依赖系统语音）

**Interfaces:**
- Consumes: 无
- Produces:
  - `#[tauri::command] pub fn tts_speak(text: String, rate: f64) -> Result<(), String>` — 朗读，多线程执行避免阻塞
  - `#[tauri::command] pub fn tts_stop() -> Result<(), String>`
  - `#[tauri::command] pub fn tts_set_rate(rate: f64) -> Result<(), String>`
  - `TtsBar({ onRateChange })` — 播放/暂停/停止/语速滑条

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/tts_test.rs`：
```rust
use yd_lib::tts::TtsEngine;

#[test]
fn rate_clamping() {
    let engine = TtsEngine::new();
    engine.set_rate(5.0);
    assert_eq!(engine.rate(), 2.0);
    engine.set_rate(0.1);
    assert_eq!(engine.rate(), 0.5);
    engine.set_rate(1.5);
    assert_eq!(engine.rate(), 1.5);
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test tts_test`
Expected: 编译失败（模块不存在）。

- [ ] **Step 3: 实现 tts.rs**

```rust
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct TtsEngine {
    rate: Mutex<f64>,
    running: Arc<AtomicBool>,
}

impl TtsEngine {
    pub fn new() -> Self {
        Self { rate: Mutex::new(1.0), running: Arc::new(AtomicBool::new(false)) }
    }
    pub fn rate(&self) -> f64 {
        *self.rate.lock().unwrap()
    }
    pub fn set_rate(&self, rate: f64) {
        let clamped = rate.clamp(0.5, 2.0);
        *self.rate.lock().unwrap() = clamped;
    }
    pub fn speak(&self, text: &str) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            self.stop()?;
        }
        let text = text.to_string();
        let running = self.running.clone();
        self.running.store(true, Ordering::SeqCst);
        std::thread::spawn(move || {
            let result = speak_platform(&text);
            running.store(false, Ordering::SeqCst);
            result
        });
        Ok(())
    }
    pub fn stop(&self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        stop_platform()
    }
}

fn speak_platform(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 使用 PowerShell SAPI 朗读
        let script = format!(
            "$s = New-Object -ComObject SAPI.SpVoice; $s.Rate = 0; $s.Speak('{}')",
            text.replace('\'', "''")
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("say")
            .arg(text)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("espeak")
            .args(["-g", "5", text])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败(需要 espeak): {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = text;
        Err("当前平台不支持 TTS".into())
    }
}

fn stop_platform() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/f", "/im", "powershell.exe"])
            .spawn();
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill").args(["-f", "say"]).spawn();
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkill").args(["-f", "espeak"]).spawn();
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(())
    }
}
```
> 说明：Windows 用 PowerShell + SAPI 朗读，停用先 `taskkill`。`running` 标记保证重复点击时先停止再开始。

`commands.rs` 追加（在 AppState 中持有引擎）：
```rust
// 更新 Task 3 的 AppState 定义，增加 tts 字段：
pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    pub tts: TtsEngine,
}

impl AppState {
    pub fn books_dir(&self) -> PathBuf {
        self.app_data_dir.join("books")
    }
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
```
对应 `lib.rs` 的 `setup` 中改为：
```rust
app.manage(AppState {
    db: std::sync::Mutex::new(conn),
    app_data_dir,
    tts: crate::tts::TtsEngine::new(),
});
```
`TtsEngine` 内部用 Mutex 与 Arc，满足 Send + Sync。同时 `commands.rs` 顶部 `use crate::tts::TtsEngine;`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --test tts_test`
Expected: PASS。

- [ ] **Step 5: 实现 TtsBar 并接入 ReaderPage**

`src/components/TtsBar.tsx`：
```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function TtsBar() {
  const [rate, setRate] = useState(1.0);
  const [reading, setReading] = useState(false);

  const getSelectedText = (): string => {
    const sel = window.getSelection()?.toString() ?? "";
    return sel.trim();
  };

  const speak = async () => {
    const text = getSelectedText() || "当前没有选中文本，请先选中要朗读的内容。";
    await invoke("tts_speak", { text, rate });
    setReading(true);
  };

  const stop = async () => {
    await invoke("tts_stop");
    setReading(false);
  };

  return (
    <div className="tts-bar">
      <button className="btn-secondary" onClick={speak}>{reading ? "重新朗读" : "朗读选中"}</button>
      <button className="btn-secondary" onClick={stop}>停止</button>
      <label htmlFor="rate">语速</label>
      <input id="rate" type="range" min={0.5} max={2} step={0.1} value={rate}
        onChange={(e) => setRate(parseFloat(e.target.value))} />
      <span>{rate.toFixed(1)}x</span>
    </div>
  );
}
```
`ReaderPage.tsx` 工具栏加 `<TtsBar />`；`ReaderPage.css` 追加 `.tts-bar { display: flex; align-items: center; gap: 10px; }` 与 `input[type=range] { width: 120px; }`。

- [ ] **Step 6: 运行全部测试**

Run: `cargo test && npm test`
Expected: 全部 PASS。

- [ ] **Step 7: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 打开 TXT/EPUB，选中文本点「朗读选中」听到语音，点「停止」停止。
```bash
git add src/ src-tauri/
git commit -m "feat: TTS 朗读"
```

---

### Task 11: 个性化设置与夜间模式

**Files:**
- Create: `src/components/theme.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/ReaderPage.tsx`（应用主题/字体）
- Modify: `src/App.css`
- Test: `src/components/theme.test.ts`

**Interfaces:**
- Consumes: `get_setting_cmd` / `set_setting_cmd`
- Produces:
  - `applyTheme(theme: "light" | "dark")` — 切换 `<html data-theme>`
  - `getFontSize(): number`, `setFontSize(n)`, `getTheme(): "light"|"dark"`, `setTheme(t)`
  - SettingsPage 表单：主题、字号、字体、行距、默认语速

- [ ] **Step 1: 写失败的测试**

`src/components/theme.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTheme, getTheme, setTheme, getFontSize, setFontSize } from "./theme";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("applies dark theme attribute", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("roundtrips font size", async () => {
    (api.setSetting as any).mockResolvedValue(undefined);
    (api.getSetting as any).mockResolvedValue("18");
    await setFontSize(18);
    expect(getFontSize()).toBe(18);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- theme`
Expected: FAIL。

- [ ] **Step 3: 实现 theme.ts**

```ts
import { getSetting, setSetting } from "../services/api";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getTheme(): Theme {
  return (document.documentElement.getAttribute("data-theme") as Theme) || "light";
}

export async function setTheme(theme: Theme) {
  applyTheme(theme);
  await setSetting("theme", theme);
}

export async function initTheme() {
  const saved = await getSetting("theme");
  applyTheme(saved === "dark" ? "dark" : "light");
}

export function getFontSize(): number {
  return Number(localStorage.getItem("reader.fontSize") ?? "18");
}

export async function setFontSize(n: number) {
  localStorage.setItem("reader.fontSize", String(n));
  applyFontSize(n);
  await setSetting("font_size", String(n));
}

export function applyFontSize(n: number) {
  document.documentElement.style.fontSize = `${n}px`;
}
```

- [ ] **Step 4: 实现 SettingsPage**

`src/pages/SettingsPage.tsx`：
```tsx
import { useEffect, useState } from "react";
import { getFontSize, setFontSize, Theme, initTheme, setTheme, getTheme } from "../components/theme";

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [fontSize, setFontSizeState] = useState(18);

  useEffect(() => {
    void initTheme().then(() => setThemeState(getTheme()));
    setFontSizeState(getFontSize());
  }, []);

  return (
    <div className="settings">
      <header className="library-header">
        <h1>设置</h1>
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
      </header>
      <div className="settings-form">
        <label>
          主题
          <select value={theme} onChange={(e) => { const t = e.target.value as Theme; setThemeState(t); void setTheme(t); }}>
            <option value="light">白天</option>
            <option value="dark">夜间</option>
          </select>
        </label>
        <label>
          字号
          <input type="range" min={12} max={32} value={fontSize}
            onChange={(e) => { const n = +e.target.value; setFontSizeState(n); void setFontSize(n); }} />
          <span>{fontSize}px</span>
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 夜间主题样式**

`src/App.css` 追加（CSS 变量 + 夜间覆盖）：
```css
:root {
  --bg: #ffffff; --fg: #1a1a1a; --panel-bg: #fafafa; --border: #e5e5e5;
}
[data-theme="dark"] {
  --bg: #1e1e1e; --fg: #e8e8e8; --panel-bg: #262626; --border: #333;
}
body { background: var(--bg); color: var(--fg); }
.reader-toolbar, .panel { background: var(--panel-bg); border-color: var(--border); }
.md-reader, .txt-page, .library, .settings { background: var(--bg); color: var(--fg); }
.btn-secondary { background: var(--panel-bg); color: var(--fg); border-color: var(--border); }
.book-meta span { color: #888; }
```
> 在 App 入口（`src/main.tsx`）调用 `void initTheme(); void (async () => setFontSizeState 不需要，用 applyFontSize(getFontSize()))();`。

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- theme`
Expected: PASS。

- [ ] **Step 7: tauri dev 冒烟 + 提交**

Run: `npm run tauri dev`
Expected: 设置页切换夜间模式立即生效，字号调整影响阅读页。
```bash
git add src/
git commit -m "feat: 个性化设置与夜间模式"
```

---

### Task 12: 错误处理、测试补全与打包

**Files:**
- Modify: 各模块错误分支（阅读器捕获损坏文件、书架缺失文件标记）
- Create: `src-tauri/tauri.conf.json` 打包配置（若脚手架未配置 bundle targets）
- Test: 冒烟清单（见下）
- Docs: `README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 可打包的分发版本（Windows 默认；macOS/Linux 依环境）

- [ ] **Step 1: 阅读器错误捕获补全**

在 `MdReader`/`TxtReader` 的 `readFileContent` 调用加 try/catch：
```tsx
} catch (e) { setError(String(e)); }
```
（组件内新增 `const [error, setError] = useState<string | null>(null);`，页面渲染 `{error && <p className="error">{error}</p>}`。）

在 `EpubReader` 的 `book.ready` Promise catch 与 `PdfReader` 已有 catch 保持。书架对缺失文件：`list_books_cmd` 返回后前端过滤 `!fs.existsSync` 不可行（前端无 fs），改为：打开失败时 ReaderPage 显示「文件缺失或已损坏」并给「移除该书」按钮（调用 `remove_book`）。

- [ ] **Step 2: 补全缺失文件处理**

`ReaderPage.tsx` 顶层加错误态：
```tsx
const [openError, setOpenError] = useState<string | null>(null);
// 各 reader 的 onError 回调 → setOpenError
// 渲染：{openError && (
//   <div className="error-box"><p>{openError}</p>
//     <button onClick={async () => { await removeBook(book.id); onBack(); }}>移除该书</button>
//   </div>)}
```
阅读器组件新增可选 `onError?: (msg: string) => void` prop；打开/解析失败时调用。

- [ ] **Step 3: 前端全部测试运行**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 4: Rust 全部测试运行**

Run: `cargo test`
Expected: 全部 PASS。

- [ ] **Step 5: 打包**

Run: `npm run tauri build`
Expected: 在 `src-tauri/target/release/bundle/` 生成安装包（Windows 为 `.msi`/`.exe`，取决于 tauri.conf.json 的 `bundle.targets`）。若打包遇到图标缺失，生成默认图标或移除 `icons` 引用。

- [ ] **Step 6: 冒烟清单（手动执行）**

按顺序验证：
1. 导入 epub/pdf/md/txt 各一，封面/占位显示正确
2. EPUB 打开翻页，进度保存恢复（关闭重开）
3. PDF 翻页/缩放，页码恢复
4. MD/TXT 滚动/翻页恢复
5. 选中 EPUB 文本创建高亮 → 标注面板可见 → 点击跳转 → 点击删除
6. 书签添加/跳转/删除
7. 全文搜索命中 TXT 词条并跳转
8. 选中文本朗读/停止
9. 夜间模式切换即时生效
10. 删除书籍后书架刷新、进度/标注清理
11. 损坏的 txt（二进制内容）打开不崩溃并提示

- [ ] **Step 7: 写 README**

`README.md`：
```markdown
# 阅卷

跨平台桌面阅读器（Tauri 2 + React + TypeScript + SQLite）。

支持 EPUB / PDF / Markdown / TXT，内置书架、标注书签、全文搜索、TTS 朗读、夜间模式。

## 开发
npm install
npm run tauri dev

## 测试
npm test        # 前端 Vitest
cargo test      # Rust 测试

## 打包
npm run tauri build
```

- [ ] **Step 8: 提交**

```bash
git add .
git commit -m "feat: 错误处理、冒烟测试与打包配置"
```

---

## 已知限制（记录于 spec 附录）

- PDF 全文搜索依赖 `pdf-extract`；若该 crate 在目标平台编译失败，PDF 搜索降级为不索引（`extract_pdf_text` 返回空串）。
- 搜索跳转仅支持「打开书籍」，正文内精确定位在 PDF/MD/TXT 中用 `window.find` 尽力而为，EPUB 暂时跳转至开头。
- 标注高亮交互为「选中即黄色高亮」的 MVP 形态，颜色选择通过面板后续增加。
- TTS 使用系统语音与子进程，语速在系统级设置；Windows 停止通过结束 powershell 进程实现。
