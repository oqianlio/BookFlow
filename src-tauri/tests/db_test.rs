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
