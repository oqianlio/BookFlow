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
    // Windows 上打开的文件无法直接删除，需先释放数据库连接
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
