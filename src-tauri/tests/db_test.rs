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
    add_annotation(&conn, &NewAnnotation {
        book_id: id, format: "epub".into(), location: "cfi1".into(),
        text: "高亮文本".into(), note: None, color: "yellow".into(),
    }).unwrap();
    add_bookmark(&conn, &NewBookmark {
        book_id: id, location: "cfi2".into(), label: "第一章".into(),
    }).unwrap();
    assert_eq!(list_annotations(&conn, id).unwrap().len(), 1);
    assert_eq!(list_bookmarks(&conn, id).unwrap().len(), 1);
    delete_book(&conn, id).unwrap();
    assert!(list_books(&conn).unwrap().is_empty());
    assert!(get_progress(&conn, id).unwrap().is_none());
    assert!(list_annotations(&conn, id).unwrap().is_empty());
    assert!(list_bookmarks(&conn, id).unwrap().is_empty());
    drop(conn);
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
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn settings_roundtrip() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    set_setting(&conn, "theme", "dark").unwrap();
    assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".into()));
    assert_eq!(get_setting(&conn, "nope").unwrap(), None);
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn shelf_source_book_crud_and_cascade() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "示例", "https://ex.com", "{}").unwrap();
    let id1 = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), author: Some("刘慈欣".into()), cover_url: None,
    }).unwrap();
    // upsert 幂等：同 key 再次加入返回同一 id 且只保留一条
    let id2 = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体（新版）".into(), author: Some("刘慈欣".into()), cover_url: None,
    }).unwrap();
    assert_eq!(id1, id2);
    let list = list_shelf_source_books(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "三体（新版）");
    assert_eq!(list[0].source_name, "示例");
    // save_source_progress 联动 last_opened_at
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), chapter_index: 2, chapter_url: "https://ex.com/c/2.html".into(),
        chapter_name: "第二章".into(), percent: 0.5,
    }).unwrap();
    let list2 = list_shelf_source_books(&conn).unwrap();
    assert!(list2[0].last_opened_at.is_some());
    // 删除书源级联删除书架条目
    delete_source(&conn, sid).unwrap();
    assert!(list_shelf_source_books(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn shelf_source_book_remove() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "示例", "https://ex.com", "{}").unwrap();
    let id = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), author: None, cover_url: None,
    }).unwrap();
    remove_shelf_source_book(&conn, id).unwrap();
    assert!(list_shelf_source_books(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
