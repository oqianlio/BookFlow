use rusqlite::{params, Connection, Result};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

pub fn init_db(path: impl AsRef<Path>) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
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

pub fn get_book(conn: &Connection, id: i64) -> Result<Option<Book>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, format, path, cover_path, added_at, last_opened_at
         FROM books WHERE id = ?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(r) = rows.next()? {
        Ok(Some(Book {
            id: r.get(0)?, title: r.get(1)?, format: r.get(2)?,
            path: r.get(3)?, cover_path: r.get(4)?, added_at: r.get(5)?,
            last_opened_at: r.get(6)?,
        }))
    } else {
        Ok(None)
    }
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
