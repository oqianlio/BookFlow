use std::fs;
use tempfile::tempdir;
use yd_lib::db::*;

#[test]
fn source_crud() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let id = add_source(&conn, "示例", "https://ex.com", "{\"a\":1}").unwrap();
    let list = list_sources(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "示例");
    set_source_enabled(&conn, id, false).unwrap();
    assert!(!list_sources(&conn).unwrap()[0].enabled);
    update_source(&conn, id, "改名", "https://ex.com", "{\"b\":2}").unwrap();
    assert_eq!(list_sources(&conn).unwrap()[0].json, "{\"b\":2}");
    delete_source(&conn, id).unwrap();
    assert!(list_sources(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn source_progress_upsert() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "s", "https://ex.com", "{}").unwrap();
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/book/1.html".into(),
        title: "三体".into(), chapter_index: 0, chapter_url: "c0".into(),
        chapter_name: "第一章".into(), percent: 0.5,
    }).unwrap();
    let p = get_source_progress(&conn, sid, "https://ex.com/book/1.html").unwrap().unwrap();
    assert_eq!(p.chapter_name, "第一章");
    assert!((p.percent - 0.5).abs() < 1e-9);
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/book/1.html".into(),
        title: "三体".into(), chapter_index: 1, chapter_url: "c1".into(),
        chapter_name: "第二章".into(), percent: 0.1,
    }).unwrap();
    let p2 = get_source_progress(&conn, sid, "https://ex.com/book/1.html").unwrap().unwrap();
    assert_eq!(p2.chapter_name, "第二章");
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
