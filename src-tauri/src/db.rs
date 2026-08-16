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
        CREATE TABLE IF NOT EXISTS book_sources (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            json TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_used_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS book_source_progress (
            source_id INTEGER NOT NULL,
            book_url TEXT NOT NULL,
            title TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            chapter_url TEXT NOT NULL,
            chapter_name TEXT NOT NULL,
            percent REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (source_id, book_url)
        );
        CREATE TABLE IF NOT EXISTS shelf_source_books (
            id INTEGER PRIMARY KEY,
            source_id INTEGER NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
            book_url TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover_url TEXT,
            added_at INTEGER NOT NULL,
            last_opened_at INTEGER,
            UNIQUE(source_id, book_url)
        );
        CREATE TABLE IF NOT EXISTS chapter_cache (
            source_id INTEGER NOT NULL,
            book_url TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            chapter_url TEXT NOT NULL,
            chapter_name TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (source_id, book_url, chapter_url)
        );
        CREATE TABLE IF NOT EXISTS reading_stats (
            source_id INTEGER NOT NULL,
            book_url TEXT NOT NULL,
            title TEXT NOT NULL,
            read_seconds INTEGER NOT NULL DEFAULT 0,
            read_count INTEGER NOT NULL DEFAULT 0,
            last_read_at INTEGER,
            PRIMARY KEY (source_id, book_url)
        );
        CREATE TABLE IF NOT EXISTS rss_feeds (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            site_url TEXT,
            added_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rss_articles (
            id INTEGER PRIMARY KEY,
            feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
            guid TEXT NOT NULL,
            title TEXT NOT NULL,
            link TEXT,
            content TEXT,
            published_at INTEGER,
            fetched_at INTEGER NOT NULL,
            UNIQUE(feed_id, guid)
        );
        CREATE TABLE IF NOT EXISTS source_subscriptions (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            last_checked_at INTEGER
        );
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct SourceRow {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub json: String,
    pub enabled: bool,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SourceProgress {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub percent: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewSourceProgress {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub percent: f64,
}

pub fn list_sources(conn: &Connection) -> Result<Vec<SourceRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, json, enabled, last_used_at FROM book_sources ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SourceRow {
            id: r.get(0)?, name: r.get(1)?, url: r.get(2)?, json: r.get(3)?,
            enabled: r.get::<_, i64>(4)? != 0, last_used_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn add_source(conn: &Connection, name: &str, url: &str, json: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO book_sources (name, url, json) VALUES (?1, ?2, ?3)",
        params![name, url, json],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_source(conn: &Connection, id: i64, name: &str, url: &str, json: &str) -> Result<()> {
    conn.execute(
        "UPDATE book_sources SET name=?1, url=?2, json=?3 WHERE id=?4",
        params![name, url, json, id],
    )?;
    Ok(())
}

pub fn delete_source(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM book_sources WHERE id=?1", [id])?;
    conn.execute("DELETE FROM book_source_progress WHERE source_id=?1", [id])?;
    Ok(())
}

pub fn set_source_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE book_sources SET enabled=?1 WHERE id=?2",
        params![if enabled { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn get_source_progress(
    conn: &Connection,
    source_id: i64,
    book_url: &str,
) -> Result<Option<SourceProgress>> {
    let mut stmt = conn.prepare(
        "SELECT source_id, book_url, title, chapter_index, chapter_url, chapter_name, percent, updated_at FROM book_source_progress WHERE source_id=?1 AND book_url=?2",
    )?;
    let mut rows = stmt.query(params![source_id, book_url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(SourceProgress {
            source_id: r.get(0)?, book_url: r.get(1)?, title: r.get(2)?,
            chapter_index: r.get(3)?, chapter_url: r.get(4)?, chapter_name: r.get(5)?,
            percent: r.get(6)?, updated_at: r.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn save_source_progress(conn: &Connection, p: &NewSourceProgress) -> Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    // 进度 + 书架联动两次写包在同一事务，避免部分成功导致不一致
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO book_source_progress (source_id, book_url, title, chapter_index, chapter_url, chapter_name, percent, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(source_id, book_url) DO UPDATE SET title=excluded.title, chapter_index=excluded.chapter_index,
           chapter_url=excluded.chapter_url, chapter_name=excluded.chapter_name, percent=excluded.percent, updated_at=excluded.updated_at",
        params![p.source_id, p.book_url, p.title, p.chapter_index, p.chapter_url, p.chapter_name, p.percent, now],
    )?;
    // 书架联动：书在架时更新打开时间（不在架则无操作）
    tx.execute(
        "UPDATE shelf_source_books SET last_opened_at = ?1 WHERE source_id = ?2 AND book_url = ?3",
        params![now, p.source_id, p.book_url],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShelfSourceBook {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub book_url: String,
    pub title: String,
    pub author: Option<String>,
    pub cover_url: Option<String>,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewShelfSourceBook {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub author: Option<String>,
    pub cover_url: Option<String>,
}

pub fn add_shelf_source_book(conn: &Connection, b: &NewShelfSourceBook) -> Result<i64> {
    let t = now();
    conn.execute(
        "INSERT INTO shelf_source_books (source_id, book_url, title, author, cover_url, added_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
         ON CONFLICT(source_id, book_url) DO UPDATE SET title = excluded.title, author = excluded.author, cover_url = excluded.cover_url",
        params![b.source_id, b.book_url, b.title, b.author, b.cover_url, t],
    )?;
    let id = conn.query_row(
        "SELECT id FROM shelf_source_books WHERE source_id = ?1 AND book_url = ?2",
        params![b.source_id, b.book_url],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn list_shelf_source_books(conn: &Connection) -> Result<Vec<ShelfSourceBook>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.source_id, bs.name, s.book_url, s.title, s.author, s.cover_url, s.added_at, s.last_opened_at
         FROM shelf_source_books s JOIN book_sources bs ON bs.id = s.source_id
         ORDER BY COALESCE(s.last_opened_at, s.added_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ShelfSourceBook {
            id: r.get(0)?, source_id: r.get(1)?, source_name: r.get(2)?,
            book_url: r.get(3)?, title: r.get(4)?, author: r.get(5)?,
            cover_url: r.get(6)?, added_at: r.get(7)?, last_opened_at: r.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn remove_shelf_source_book(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM shelf_source_books WHERE id = ?1", [id])?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CachedChapter {
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewCachedChapter {
    pub source_id: i64,
    pub book_url: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub content: String,
}

pub fn save_cached_chapter(conn: &Connection, c: &NewCachedChapter) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO chapter_cache (source_id, book_url, chapter_index, chapter_url, chapter_name, content, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source_id, book_url, chapter_url) DO UPDATE SET
           chapter_index = excluded.chapter_index,
           chapter_name = excluded.chapter_name,
           content = excluded.content,
           updated_at = excluded.updated_at",
        params![c.source_id, c.book_url, c.chapter_index, c.chapter_url, c.chapter_name, c.content, t],
    )?;
    Ok(())
}

pub fn list_cached_chapters(conn: &Connection, source_id: i64, book_url: &str) -> Result<Vec<CachedChapter>> {
    let mut stmt = conn.prepare(
        "SELECT chapter_index, chapter_url, chapter_name, updated_at FROM chapter_cache
         WHERE source_id = ?1 AND book_url = ?2 ORDER BY chapter_index",
    )?;
    let rows = stmt.query_map(params![source_id, book_url], |r| {
        Ok(CachedChapter {
            chapter_index: r.get(0)?, chapter_url: r.get(1)?,
            chapter_name: r.get(2)?, updated_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn get_cached_chapter(conn: &Connection, source_id: i64, book_url: &str, chapter_url: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT content FROM chapter_cache WHERE source_id = ?1 AND book_url = ?2 AND chapter_url = ?3",
    )?;
    let mut rows = stmt.query(params![source_id, book_url, chapter_url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(r.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn delete_book_cache(conn: &Connection, source_id: i64, book_url: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM chapter_cache WHERE source_id = ?1 AND book_url = ?2",
        params![source_id, book_url],
    )?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheSummary {
    pub book_count: i64,
    pub chapter_count: i64,
    pub total_bytes: i64,
}

pub fn cache_summary(conn: &Connection) -> Result<CacheSummary> {
    let book_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT source_id || '|' || book_url) FROM chapter_cache",
        [], |r| r.get(0),
    )?;
    let chapter_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chapter_cache",
        [], |r| r.get(0),
    )?;
    let total_bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM chapter_cache",
        [], |r| r.get(0),
    )?;
    Ok(CacheSummary { book_count, chapter_count, total_bytes })
}

pub fn clear_all_cache(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM chapter_cache", [])?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReadingStats {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub read_seconds: i64,
    pub read_count: i64,
    pub last_read_at: Option<i64>,
}

pub fn record_read(
    conn: &Connection,
    source_id: i64,
    book_url: &str,
    title: &str,
    seconds: i64,
    increment_count: bool,
) -> Result<()> {
    let t = now();
    let add = if increment_count { 1 } else { 0 };
    conn.execute(
        "INSERT INTO reading_stats (source_id, book_url, title, read_seconds, read_count, last_read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_id, book_url) DO UPDATE SET
           read_seconds = read_seconds + excluded.read_seconds,
           title = excluded.title,
           read_count = read_count + ?7,
           last_read_at = excluded.last_read_at",
        params![source_id, book_url, title, seconds, add, t, add],
    )?;
    Ok(())
}

pub fn get_reading_stats(conn: &Connection, source_id: i64, book_url: &str) -> Result<Option<ReadingStats>> {
    let mut stmt = conn.prepare(
        "SELECT source_id, book_url, title, read_seconds, read_count, last_read_at FROM reading_stats WHERE source_id=?1 AND book_url=?2",
    )?;
    let mut rows = stmt.query(params![source_id, book_url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(ReadingStats {
            source_id: r.get(0)?, book_url: r.get(1)?, title: r.get(2)?,
            read_seconds: r.get(3)?, read_count: r.get(4)?, last_read_at: r.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RssFeedRow {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RssArticleRow {
    pub id: i64,
    pub feed_id: i64,
    pub guid: String,
    pub title: String,
    pub link: Option<String>,
    pub content: Option<String>,
    pub published_at: Option<i64>,
    pub fetched_at: i64,
}

pub fn add_rss_feed_db(conn: &Connection, title: &str, url: &str, site_url: Option<&str>) -> Result<i64> {
    conn.execute(
        "INSERT INTO rss_feeds (title, url, site_url, added_at) VALUES (?1, ?2, ?3, ?4)",
        params![title, url, site_url, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_rss_feed_db(conn: &Connection, id: i64) -> Result<Option<RssFeedRow>> {
    let mut stmt = conn.prepare("SELECT id, title, url, site_url, added_at FROM rss_feeds WHERE id=?1")?;
    let mut rows = stmt.query([id])?;
    if let Some(r) = rows.next()? {
        Ok(Some(RssFeedRow {
            id: r.get(0)?, title: r.get(1)?, url: r.get(2)?, site_url: r.get(3)?, added_at: r.get(4)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn list_rss_feeds_db(conn: &Connection) -> Result<Vec<RssFeedRow>> {
    let mut stmt = conn.prepare("SELECT id, title, url, site_url, added_at FROM rss_feeds ORDER BY added_at")?;
    let rows = stmt.query_map([], |r| {
        Ok(RssFeedRow {
            id: r.get(0)?, title: r.get(1)?, url: r.get(2)?, site_url: r.get(3)?, added_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn delete_rss_feed_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM rss_feeds WHERE id=?1", [id])?;
    Ok(())
}

/// 返回 1=新增, 0=已存在(更新内容)
pub fn upsert_rss_article(
    conn: &Connection,
    feed_id: i64,
    a: &crate::rss::RssArticlePreview,
) -> Result<i64> {
    let fetched = now();
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM rss_articles WHERE feed_id=?1 AND guid=?2",
            params![feed_id, a.guid],
            |r| r.get(0),
        )
        .ok();
    match existing {
        Some(_) => {
            conn.execute(
                "UPDATE rss_articles SET title=?1, link=?2, content=?3, published_at=?4, fetched_at=?5 WHERE feed_id=?6 AND guid=?7",
                params![a.title, a.link, a.content, a.published_at, fetched, feed_id, a.guid],
            )?;
            Ok(0)
        }
        None => {
            conn.execute(
                "INSERT INTO rss_articles (feed_id, guid, title, link, content, published_at, fetched_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![feed_id, a.guid, a.title, a.link, a.content, a.published_at, fetched],
            )?;
            Ok(1)
        }
    }
}

pub fn list_rss_articles_db(conn: &Connection, feed_id: i64) -> Result<Vec<RssArticleRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, feed_id, guid, title, link, content, published_at, fetched_at FROM rss_articles WHERE feed_id=?1 ORDER BY COALESCE(published_at, fetched_at) DESC",
    )?;
    let rows = stmt.query_map([feed_id], |r| {
        Ok(RssArticleRow {
            id: r.get(0)?, feed_id: r.get(1)?, guid: r.get(2)?, title: r.get(3)?,
            link: r.get(4)?, content: r.get(5)?, published_at: r.get(6)?, fetched_at: r.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_rss_article_db(conn: &Connection, id: i64) -> Result<Option<RssArticleRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, feed_id, guid, title, link, content, published_at, fetched_at FROM rss_articles WHERE id=?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(r) = rows.next()? {
        Ok(Some(RssArticleRow {
            id: r.get(0)?, feed_id: r.get(1)?, guid: r.get(2)?, title: r.get(3)?,
            link: r.get(4)?, content: r.get(5)?, published_at: r.get(6)?, fetched_at: r.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SubscriptionRow {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub last_checked_at: Option<i64>,
}

pub fn add_subscription_db(conn: &Connection, name: &str, url: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO source_subscriptions (name, url) VALUES (?1, ?2)",
        params![name, url],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_subscriptions_db(conn: &Connection) -> Result<Vec<SubscriptionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, last_checked_at FROM source_subscriptions ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SubscriptionRow {
            id: r.get(0)?, name: r.get(1)?, url: r.get(2)?, last_checked_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn delete_subscription_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM source_subscriptions WHERE id=?1", [id])?;
    Ok(())
}

pub fn set_subscription_checked_db(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE source_subscriptions SET last_checked_at=?1 WHERE id=?2",
        params![now(), id],
    )?;
    Ok(())
}

pub fn get_source_by_url_db(conn: &Connection, url: &str) -> Result<Option<SourceRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, json, enabled, last_used_at FROM book_sources WHERE url=?1",
    )?;
    let mut rows = stmt.query([url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(SourceRow {
            id: r.get(0)?, name: r.get(1)?, url: r.get(2)?, json: r.get(3)?,
            enabled: r.get::<_, i64>(4)? != 0, last_used_at: r.get(5)?,
        }))
    } else {
        Ok(None)
    }
}
