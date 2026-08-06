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
