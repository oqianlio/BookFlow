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
    #[serde(default)]
    pub sort_order: Option<i64>,
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
        );        CREATE TABLE IF NOT EXISTS chapter_cache (
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
            is_read INTEGER NOT NULL DEFAULT 0,
            UNIQUE(feed_id, guid)
        );
        CREATE TABLE IF NOT EXISTS source_subscriptions (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            last_checked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS shelf_groups (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shelf_group_members (
            group_id INTEGER NOT NULL REFERENCES shelf_groups(id) ON DELETE CASCADE,
            item_kind TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (group_id, item_kind, item_id)
        );
        CREATE TABLE IF NOT EXISTS book_lists (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS book_list_items (
            list_id INTEGER NOT NULL REFERENCES book_lists(id) ON DELETE CASCADE,
            item_kind TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            sort INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (list_id, item_kind, item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_shelf_group_members_kind ON shelf_group_members(item_kind, item_id);
        CREATE INDEX IF NOT EXISTS idx_book_list_items_kind ON book_list_items(item_kind, item_id);
        "#,
    )?;
    // 迁移：旧库 rss_articles 无 is_read 列（CREATE TABLE IF NOT EXISTS 不会补列）
    let has_is_read: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('rss_articles') WHERE name = 'is_read'",
        [], |r| r.get(0),
    )?;
    if has_is_read == 0 {
        conn.execute_batch("ALTER TABLE rss_articles ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0")?;
    }
    // 迁移：手动排序列（NULL = 未手动排序）
    for table in ["books", "shelf_source_books"] {
        let has_sort_order: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'sort_order'"),
            [], |r| r.get(0),
        )?;
        if has_sort_order == 0 {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN sort_order INTEGER"))?;
        }
    }
    // 迁移：在线书章节更新追踪（NEW 红点）
    let has_total_chapters: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('shelf_source_books') WHERE name = 'total_chapters'",
        [], |r| r.get(0),
    )?;
    if has_total_chapters == 0 {
        conn.execute_batch("ALTER TABLE shelf_source_books ADD COLUMN total_chapters INTEGER")?;
    }
    let has_has_update: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('shelf_source_books') WHERE name = 'has_update'",
        [], |r| r.get(0),
    )?;
    if has_has_update == 0 {
        conn.execute_batch("ALTER TABLE shelf_source_books ADD COLUMN has_update INTEGER NOT NULL DEFAULT 0")?;
    }
    // 迁移：在线书分类标签（ruleBookInfo.kind，如 "科幻,都市"）
    let has_kind: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('shelf_source_books') WHERE name = 'kind'",
        [], |r| r.get(0),
    )?;
    if has_kind == 0 {
        conn.execute_batch("ALTER TABLE shelf_source_books ADD COLUMN kind TEXT")?;
    }
    // 迁移：在线书简介（ruleBookInfo.intro，书架列表显示）
    let has_intro: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('shelf_source_books') WHERE name = 'intro'",
        [], |r| r.get(0),
    )?;
    if has_intro == 0 {
        conn.execute_batch("ALTER TABLE shelf_source_books ADD COLUMN intro TEXT")?;
    }
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
        "SELECT id, title, format, path, cover_path, added_at, last_opened_at, sort_order
         FROM books ORDER BY COALESCE(last_opened_at, added_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Book {
            id: r.get(0)?, title: r.get(1)?, format: r.get(2)?,
            path: r.get(3)?, cover_path: r.get(4)?, added_at: r.get(5)?,
            last_opened_at: r.get(6)?, sort_order: r.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_book(conn: &Connection, id: i64) -> Result<Option<Book>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, format, path, cover_path, added_at, last_opened_at, sort_order
         FROM books WHERE id = ?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(r) = rows.next()? {
        Ok(Some(Book {
            id: r.get(0)?, title: r.get(1)?, format: r.get(2)?,
            path: r.get(3)?, cover_path: r.get(4)?, added_at: r.get(5)?,
            last_opened_at: r.get(6)?, sort_order: r.get(7)?,
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
    // 书架联动：书在架时更新打开时间并清除更新标记（不在架则无操作）
    tx.execute(
        "UPDATE shelf_source_books SET last_opened_at = ?1, has_update = 0 WHERE source_id = ?2 AND book_url = ?3",
        params![now, p.source_id, p.book_url],
    )?;
    tx.commit()?;
    Ok(())
}

/// 记录目录检查结果：total_chapters 与是否发现新章节（NEW 红点），并保存分类标签/简介。
/// total_chapters/kind/intro 传 NULL 时保留原值（COALESCE），便于备份恢复等部分写入场景。
pub fn set_shelf_source_toc_info(conn: &Connection, id: i64, total_chapters: Option<i64>, has_update: bool, kind: Option<String>, intro: Option<String>) -> Result<()> {
    conn.execute(
        "UPDATE shelf_source_books SET total_chapters = COALESCE(?1, total_chapters), has_update = ?2, kind = COALESCE(?3, kind), intro = COALESCE(?4, intro) WHERE id = ?5",
        params![total_chapters, if has_update { 1 } else { 0 }, kind, intro, id],
    )?;
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
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub total_chapters: Option<i64>,
    #[serde(default)]
    pub has_update: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub intro: Option<String>,
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
        "SELECT s.id, s.source_id, bs.name, s.book_url, s.title, s.author, s.cover_url, s.added_at, s.last_opened_at, s.sort_order, s.total_chapters, s.has_update, s.kind, s.intro
         FROM shelf_source_books s JOIN book_sources bs ON bs.id = s.source_id
         ORDER BY COALESCE(s.last_opened_at, s.added_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ShelfSourceBook {
            id: r.get(0)?, source_id: r.get(1)?, source_name: r.get(2)?,
            book_url: r.get(3)?, title: r.get(4)?, author: r.get(5)?,
            cover_url: r.get(6)?, added_at: r.get(7)?, last_opened_at: r.get(8)?,
            sort_order: r.get(9)?,
            total_chapters: r.get(10)?,
            has_update: r.get::<_, i64>(11)? != 0,
            kind: r.get(12)?,
            intro: r.get(13)?,
        })
    })?;
    rows.collect()
}

pub fn remove_shelf_source_book(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM shelf_source_books WHERE id = ?1", [id])?;
    Ok(())
}

/// 手动排序：按传入顺序写 sort_order（0..n），未列出的书保持不变
pub fn reorder_shelf_items(conn: &Connection, items: &[ShelfMember]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, m) in items.iter().enumerate() {
        match m.item_kind.as_str() {
            "local" => {
                tx.execute(
                    "UPDATE books SET sort_order = ?1 WHERE id = ?2",
                    params![i as i64, m.item_id],
                )?;
            }
            "source" => {
                tx.execute(
                    "UPDATE shelf_source_books SET sort_order = ?1 WHERE id = ?2",
                    params![i as i64, m.item_id],
                )?;
            }
            _ => {}
        }
    }
    tx.commit()?;
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

/// 按书聚合的缓存条目（缓存管理 UI 用）。书名优先取书架记录，否则用 URL 最后一段。
#[derive(Debug, Clone, serde::Serialize)]
pub struct CachedBook {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub chapter_count: i64,
    pub bytes: i64,
    pub updated_at: i64,
}

pub fn list_cached_books(conn: &Connection) -> Result<Vec<CachedBook>> {
    let mut stmt = conn.prepare(
        "SELECT c.source_id, c.book_url,
                COALESCE((SELECT s.title FROM shelf_source_books s WHERE s.source_id = c.source_id AND s.book_url = c.book_url LIMIT 1), '') AS title,
                COUNT(*) AS cnt, SUM(LENGTH(content)) AS bytes, MAX(updated_at) AS up
         FROM chapter_cache c GROUP BY c.source_id, c.book_url ORDER BY up DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        let url: String = r.get(1)?;
        let title: String = r.get(2)?;
        let title = if title.is_empty() {
            url.rsplit('/').next().unwrap_or(&url).to_string()
        } else {
            title
        };
        Ok(CachedBook {
            source_id: r.get(0)?, book_url: url, title,
            chapter_count: r.get(3)?, bytes: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
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

/// 阅读统计汇总（仪表盘用）
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReadingSummary {
    /// 阅读过的书数
    pub total_books: i64,
    /// 总阅读秒数
    pub total_seconds: i64,
    /// 今日阅读秒数
    pub today_seconds: i64,
    /// 阅读书籍排行（按时长降序，取前 N）
    pub top_books: Vec<ReadingStats>,
    /// 最近阅读的书（按 last_read_at 降序，取前 N）
    pub recent_reads: Vec<ReadingStats>,
}

pub fn get_reading_summary(conn: &Connection, limit: i64) -> Result<ReadingSummary> {
    let t = now();
    let today_start = t - (t % 86400); // 今天 00:00:00 的秒级时间戳
    // 总统计
    let mut stmt = conn.prepare(
        "SELECT COUNT(*), COALESCE(SUM(read_seconds), 0) FROM reading_stats",
    )?;
    let row = stmt.query_row([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    let (total_books, total_seconds) = row;
    // 今日阅读（基于 last_read_at 判断是否今天读过；更精确需 read_log 表，先简化）
    let mut stmt2 = conn.prepare(
        "SELECT COALESCE(SUM(read_seconds), 0) FROM reading_stats WHERE last_read_at >= ?1",
    )?;
    let today_seconds = stmt2.query_row(params![today_start], |r| r.get::<_, i64>(0))?;
    // Top books by read_seconds
    let mut stmt3 = conn.prepare(
        "SELECT source_id, book_url, title, read_seconds, read_count, last_read_at
         FROM reading_stats ORDER BY read_seconds DESC LIMIT ?1",
    )?;
    let top_books: Vec<ReadingStats> = stmt3
        .query_map(params![limit], |r| {
            Ok(ReadingStats {
                source_id: r.get(0)?, book_url: r.get(1)?, title: r.get(2)?,
                read_seconds: r.get(3)?, read_count: r.get(4)?, last_read_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Recent reads by last_read_at
    let mut stmt4 = conn.prepare(
        "SELECT source_id, book_url, title, read_seconds, read_count, last_read_at
         FROM reading_stats WHERE last_read_at IS NOT NULL
         ORDER BY last_read_at DESC LIMIT ?1",
    )?;
    let recent_reads: Vec<ReadingStats> = stmt4
        .query_map(params![limit], |r| {
            Ok(ReadingStats {
                source_id: r.get(0)?, book_url: r.get(1)?, title: r.get(2)?,
                read_seconds: r.get(3)?, read_count: r.get(4)?, last_read_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReadingSummary { total_books, total_seconds, today_seconds, top_books, recent_reads })
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
    pub is_read: bool,
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
        "SELECT id, feed_id, guid, title, link, content, published_at, fetched_at, is_read FROM rss_articles WHERE feed_id=?1 ORDER BY COALESCE(published_at, fetched_at) DESC",
    )?;
    let rows = stmt.query_map([feed_id], |r| {
        Ok(RssArticleRow {
            id: r.get(0)?, feed_id: r.get(1)?, guid: r.get(2)?, title: r.get(3)?,
            link: r.get(4)?, content: r.get(5)?, published_at: r.get(6)?, fetched_at: r.get(7)?,
            is_read: r.get::<_, i64>(8)? != 0,
        })
    })?;
    rows.collect()
}

pub fn get_rss_article_db(conn: &Connection, id: i64) -> Result<Option<RssArticleRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, feed_id, guid, title, link, content, published_at, fetched_at, is_read FROM rss_articles WHERE id=?1",
    )?;
    let mut rows = stmt.query([id])?;
    if let Some(r) = rows.next()? {
        Ok(Some(RssArticleRow {
            id: r.get(0)?, feed_id: r.get(1)?, guid: r.get(2)?, title: r.get(3)?,
            link: r.get(4)?, content: r.get(5)?, published_at: r.get(6)?, fetched_at: r.get(7)?,
            is_read: r.get::<_, i64>(8)? != 0,
        }))
    } else {
        Ok(None)
    }
}

pub fn mark_rss_article_read(conn: &Connection, id: i64, read: bool) -> Result<()> {
    conn.execute(
        "UPDATE rss_articles SET is_read=?1 WHERE id=?2",
        params![if read { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn mark_rss_feed_read(conn: &Connection, feed_id: i64) -> Result<()> {
    conn.execute("UPDATE rss_articles SET is_read=1 WHERE feed_id=?1", [feed_id])?;
    Ok(())
}

pub fn rss_unread_count(conn: &Connection, feed_id: i64) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM rss_articles WHERE feed_id=?1 AND is_read=0",
        [feed_id],
        |r| r.get(0),
    )
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

// ============ 书架分组 ============

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShelfGroup {
    pub id: i64,
    pub name: String,
    pub member_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShelfMember {
    pub item_kind: String,
    pub item_id: i64,
}

pub fn create_shelf_group(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO shelf_groups (name, created_at) VALUES (?1, ?2)",
        params![name, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_shelf_group(conn: &Connection, id: i64, name: &str) -> Result<()> {
    conn.execute("UPDATE shelf_groups SET name=?1 WHERE id=?2", params![name, id])?;
    Ok(())
}

pub fn delete_shelf_group(conn: &Connection, id: i64) -> Result<()> {
    // 成员级联删除（ON DELETE CASCADE）
    conn.execute("DELETE FROM shelf_groups WHERE id=?1", [id])?;
    Ok(())
}

pub fn list_shelf_groups(conn: &Connection) -> Result<Vec<ShelfGroup>> {
    let mut stmt = conn.prepare(
        "SELECT g.id, g.name, g.created_at,
                (SELECT COUNT(*) FROM shelf_group_members m WHERE m.group_id = g.id) AS cnt
         FROM shelf_groups g ORDER BY g.created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ShelfGroup {
            id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?,
            member_count: r.get(3)?,
        })
    })?;
    rows.collect()
}

/// 全量覆盖式设置组成员（先清空再插入）
pub fn set_shelf_group_members(conn: &Connection, group_id: i64, members: &[ShelfMember]) -> Result<()> {
    conn.execute("DELETE FROM shelf_group_members WHERE group_id=?1", [group_id])?;
    let t = now();
    for m in members {
        conn.execute(
            "INSERT OR IGNORE INTO shelf_group_members (group_id, item_kind, item_id, added_at) VALUES (?1,?2,?3,?4)",
            params![group_id, m.item_kind, m.item_id, t],
        )?;
    }
    Ok(())
}

pub fn add_shelf_group_members(conn: &Connection, group_id: i64, members: &[ShelfMember]) -> Result<()> {
    let t = now();
    for m in members {
        conn.execute(
            "INSERT OR IGNORE INTO shelf_group_members (group_id, item_kind, item_id, added_at) VALUES (?1,?2,?3,?4)",
            params![group_id, m.item_kind, m.item_id, t],
        )?;
    }
    Ok(())
}

pub fn remove_shelf_group_members(conn: &Connection, group_id: i64, members: &[ShelfMember]) -> Result<()> {
    for m in members {
        conn.execute(
            "DELETE FROM shelf_group_members WHERE group_id=?1 AND item_kind=?2 AND item_id=?3",
            params![group_id, m.item_kind, m.item_id],
        )?;
    }
    Ok(())
}

pub fn list_shelf_group_members(conn: &Connection, group_id: i64) -> Result<Vec<ShelfMember>> {
    let mut stmt = conn.prepare(
        "SELECT item_kind, item_id FROM shelf_group_members WHERE group_id=?1 ORDER BY added_at",
    )?;
    let rows = stmt.query_map([group_id], |r| {
        Ok(ShelfMember { item_kind: r.get(0)?, item_id: r.get(1)? })
    })?;
    rows.collect()
}

/// 批量移除书架条目（本地书 + 在线书架书）。本地书删除会同步清索引（调用方负责删文件）。
pub fn remove_shelf_items(conn: &Connection, items: &[ShelfMember]) -> Result<Vec<i64>> {
    let mut deleted_local: Vec<i64> = Vec::new();
    for it in items {
        match it.item_kind.as_str() {
            "local" => {
                delete_book(conn, it.item_id)?;
                deleted_local.push(it.item_id);
            }
            "source" => {
                remove_shelf_source_book(conn, it.item_id)?;
            }
            _ => {}
        }
    }
    Ok(deleted_local)
}

// ============ 书单 ============

#[derive(Debug, Clone, serde::Serialize)]
pub struct BookList {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub item_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BookListItem {
    pub item_kind: String,
    pub item_id: i64,
    pub added_at: i64,
}

pub fn create_book_list(conn: &Connection, name: &str, description: Option<&str>) -> Result<i64> {
    conn.execute(
        "INSERT INTO book_lists (name, description, created_at) VALUES (?1, ?2, ?3)",
        params![name, description, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_book_list(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM book_lists WHERE id=?1", [id])?;
    Ok(())
}

pub fn list_book_lists(conn: &Connection) -> Result<Vec<BookList>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.name, l.description, l.created_at,
                (SELECT COUNT(*) FROM book_list_items i WHERE i.list_id = l.id) AS cnt
         FROM book_lists l ORDER BY l.created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(BookList {
            id: r.get(0)?, name: r.get(1)?, description: r.get(2)?,
            created_at: r.get(3)?, item_count: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn add_book_list_item(conn: &Connection, list_id: i64, kind: &str, item_id: i64) -> Result<()> {
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), 0) + 1 FROM book_list_items WHERE list_id=?1",
        [list_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO book_list_items (list_id, item_kind, item_id, added_at, sort) VALUES (?1,?2,?3,?4,?5)",
        params![list_id, kind, item_id, now(), sort],
    )?;
    Ok(())
}

pub fn remove_book_list_item(conn: &Connection, list_id: i64, kind: &str, item_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM book_list_items WHERE list_id=?1 AND item_kind=?2 AND item_id=?3",
        params![list_id, kind, item_id],
    )?;
    Ok(())
}

pub fn list_book_list_items(conn: &Connection, list_id: i64) -> Result<Vec<BookListItem>> {
    let mut stmt = conn.prepare(
        "SELECT item_kind, item_id, added_at FROM book_list_items WHERE list_id=?1 ORDER BY sort",
    )?;
    let rows = stmt.query_map([list_id], |r| {
        Ok(BookListItem { item_kind: r.get(0)?, item_id: r.get(1)?, added_at: r.get(2)? })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let dir = tempfile::tempdir().unwrap();
        init_db(dir.path().join("test.db")).unwrap()
    }

    #[test]
    fn shelf_group_crud_and_members() {
        let conn = test_conn();
        let g1 = create_shelf_group(&conn, "科幻").unwrap();
        let g2 = create_shelf_group(&conn, "网络文学").unwrap();
        assert!(create_shelf_group(&conn, "科幻").is_err()); // UNIQUE

        // 成员增删
        let members = vec![
            ShelfMember { item_kind: "local".into(), item_id: 1 },
            ShelfMember { item_kind: "source".into(), item_id: 2 },
        ];
        add_shelf_group_members(&conn, g1, &members).unwrap();
        add_shelf_group_members(&conn, g1, &members).unwrap(); // 幂等
        assert_eq!(list_shelf_group_members(&conn, g1).unwrap().len(), 2);

        // 全量覆盖
        set_shelf_group_members(&conn, g1, &[ShelfMember { item_kind: "local".into(), item_id: 9 }]).unwrap();
        let ms = list_shelf_group_members(&conn, g1).unwrap();
        assert_eq!(ms.len(), 1);
        assert_eq!(ms[0].item_id, 9);

        // 删除分组级联清成员
        delete_shelf_group(&conn, g1).unwrap();
        assert!(list_shelf_group_members(&conn, g1).unwrap().is_empty());

        // 分组列表含成员数
        let groups = list_shelf_groups(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, g2);
        assert_eq!(groups[0].name, "网络文学");
    }

    #[test]
    fn book_list_crud_and_items() {
        let conn = test_conn();
        let l1 = create_book_list(&conn, "2026 必读", Some("年度书单")).unwrap();
        let l2 = create_book_list(&conn, "三体", None).unwrap();

        add_book_list_item(&conn, l1, "local", 1).unwrap();
        add_book_list_item(&conn, l1, "local", 2).unwrap();
        add_book_list_item(&conn, l1, "source", 5).unwrap();
        add_book_list_item(&conn, l1, "local", 1).unwrap(); // 幂等

        let items = list_book_list_items(&conn, l1).unwrap();
        assert_eq!(items.len(), 3);

        remove_book_list_item(&conn, l1, "local", 2).unwrap();
        assert_eq!(list_book_list_items(&conn, l1).unwrap().len(), 2);

        let lists = list_book_lists(&conn).unwrap();
        assert_eq!(lists.len(), 2);
        let l1row = lists.iter().find(|l| l.id == l1).unwrap();
        assert_eq!(l1row.item_count, 2);
        assert_eq!(l1row.description.as_deref(), Some("年度书单"));

        delete_book_list(&conn, l1).unwrap();
        assert!(list_book_list_items(&conn, l1).unwrap().is_empty());
    }

    #[test]
    fn remove_shelf_items_mixed() {
        let conn = test_conn();
        // 造一条本地书与一条在线书架书
        let bid = upsert_book(&conn, &NewBook {
            title: "本地书".into(), format: "txt".into(), path: "/tmp/x.txt".into(), cover_path: None,
        }).unwrap();
        let sid = add_source(&conn, "示例源", "https://ex.com", "{}").unwrap();
        add_shelf_source_book(&conn, &NewShelfSourceBook {
            source_id: sid, book_url: "https://ex.com/b".into(),
            title: "在线书".into(), author: None, cover_url: None,
        }).unwrap();

        let deleted = remove_shelf_items(&conn, &[
            ShelfMember { item_kind: "local".into(), item_id: bid },
            ShelfMember { item_kind: "source".into(), item_id: 1 },
        ]).unwrap();
        assert_eq!(deleted, vec![bid]);
        assert!(list_books(&conn).unwrap().is_empty());
        assert!(list_shelf_source_books(&conn).unwrap().is_empty());
    }

    #[test]
    fn rss_article_read_state() {
        let conn = test_conn();
        let fid = add_rss_feed_db(&conn, "科技日报", "https://ex.com/rss.xml", None).unwrap();
        let a = crate::rss::RssArticlePreview {
            guid: "g1".into(), title: "文章甲".into(), link: Some("https://ex.com/a1".into()),
            content: Some("<p>正文</p>".into()), published_at: Some(1704067200),
        };
        upsert_rss_article(&conn, fid, &a).unwrap();
        let rows = list_rss_articles_db(&conn, fid).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].is_read);
        assert_eq!(rss_unread_count(&conn, fid).unwrap(), 1);

        mark_rss_article_read(&conn, rows[0].id, true).unwrap();
        assert_eq!(rss_unread_count(&conn, fid).unwrap(), 0);
        assert!(get_rss_article_db(&conn, rows[0].id).unwrap().unwrap().is_read);

        // 再插入一篇 → 未读 1 → 全部已读 → 0
        let b = crate::rss::RssArticlePreview {
            guid: "g2".into(), title: "文章乙".into(), link: None,
            content: None, published_at: None,
        };
        upsert_rss_article(&conn, fid, &b).unwrap();
        assert_eq!(rss_unread_count(&conn, fid).unwrap(), 1);
        mark_rss_feed_read(&conn, fid).unwrap();
        assert_eq!(rss_unread_count(&conn, fid).unwrap(), 0);
    }

    #[test]
    fn cached_books_aggregation() {
        let conn = test_conn();
        save_cached_chapter(&conn, &NewCachedChapter {
            source_id: 1, book_url: "https://ex.com/b1".into(),
            chapter_index: 0, chapter_url: "c1".into(), chapter_name: "第1章".into(),
            content: "内容一".into(),
        }).unwrap();
        save_cached_chapter(&conn, &NewCachedChapter {
            source_id: 1, book_url: "https://ex.com/b1".into(),
            chapter_index: 1, chapter_url: "c2".into(), chapter_name: "第2章".into(),
            content: "内容二内容二".into(),
        }).unwrap();
        save_cached_chapter(&conn, &NewCachedChapter {
            source_id: 2, book_url: "https://ex.com/b2".into(),
            chapter_index: 0, chapter_url: "c1".into(), chapter_name: "第1章".into(),
            content: "另一本书".into(),
        }).unwrap();

        let books = list_cached_books(&conn).unwrap();
        assert_eq!(books.len(), 2);
        let b1 = books.iter().find(|b| b.book_url == "https://ex.com/b1").unwrap();
        assert_eq!(b1.chapter_count, 2);
        // SQLite LENGTH() 按字符数计（非 UTF-8 字节数）
        assert_eq!(b1.bytes, "内容一内容二内容二".chars().count() as i64);
        assert_eq!(b1.title, "b1"); // 未在书架 → URL 最后一段兜底
    }
}
