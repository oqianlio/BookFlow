use std::fs;
use tempfile::tempdir;
use yd_lib::db::init_db;
use yd_lib::db::{upsert_book, NewBook};
use yd_lib::search::{build_index, delete_book_from_index, search};

fn add_book(conn: &rusqlite::Connection, title: &str, format: &str, path: &str) -> i64 {
    upsert_book(conn, &NewBook {
        title: title.into(), format: format.into(), path: path.into(), cover_path: None,
    }).unwrap()
}

#[test]
fn index_and_search() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    fs::write(books_root.join("a.txt"), "云上的日子十分漫长").unwrap();
    let id = add_book(&conn, "甲", "txt", &books_root.join("a.txt").to_string_lossy());
    build_index(dir.path(), &conn).unwrap();
    let hits = search(dir.path(), "漫长", 10).unwrap();
    assert!(!hits.is_empty());
    assert_eq!(hits[0].book_id, id as u64);
    assert!(hits[0].text.contains("漫长"));
    // Windows 上打开的文件无法直接删除，需先释放数据库连接
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn txt_hit_carries_line_location() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    let mut content = String::new();
    for i in 0..250 {
        if i == 150 {
            content.push_str("这里藏着特殊词云的关键句子。\n");
        } else {
            content.push_str(&format!("第{i}行普通内容\n"));
        }
    }
    let p = books_root.join("multi.txt");
    fs::write(&p, content).unwrap();
    add_book(&conn, "多行", "txt", &p.to_string_lossy());
    build_index(dir.path(), &conn).unwrap();
    let hits = search(dir.path(), "特殊词云", 10).unwrap();
    assert!(!hits.is_empty());
    // 150 行落在第二个 100 行块内，块首行号为 100
    assert_eq!(hits[0].location, "line:100");
    assert_eq!(hits[0].format, "txt");
    // 片段被截断，不返回整本书文本
    assert!(hits[0].text.len() < 300);
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

/// 构造一个带文本的最小合法 PDF（Type1 标准字体，逐字节计算 xref 偏移）。
fn make_pdf_full(pages: &[&str]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"%PDF-1.4\n");

    let mut offsets: Vec<u64> = Vec::new();
    let n = pages.len();

    offsets.push(out.len() as u64);
    out.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    offsets.push(out.len() as u64);
    let kids: String = (3..3 + n).map(|i| format!("{i} 0 R ")).collect();
    out.extend_from_slice(format!("2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {n} >>\nendobj\n").as_bytes());

    let font_num = (3 + 2 * n) as u64;
    let mut content_objs: Vec<(u64, Vec<u8>)> = Vec::new();
    for (i, text) in pages.iter().enumerate() {
        let page_num = (3 + i) as u64;
        let content_num = (3 + n + i) as u64;
        offsets.push(out.len() as u64);
        out.extend_from_slice(
            format!(
                "{page_num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_num} 0 R /Resources << /Font << /F1 {font_num} 0 R >> >> >>\nendobj\n"
            ).as_bytes(),
        );
        let esc = text.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)");
        content_objs.push((content_num, format!("BT /F1 24 Tf 72 720 Td ({esc}) Tj ET\n").into_bytes()));
    }

    for (content_num, stream) in &content_objs {
        offsets.push(out.len() as u64);
        out.extend_from_slice(
            format!("{content_num} 0 obj\n<< /Length {} >>\nstream\n", stream.len()).as_bytes(),
        );
        out.extend_from_slice(stream);
        out.extend_from_slice(b"\nendstream\nendobj\n");
    }

    offsets.push(out.len() as u64);
    out.extend_from_slice(format!("{font_num} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n").as_bytes());

    // xref
    let xref_pos = out.len() as u64;
    out.extend_from_slice(format!("xref\n0 {}\n", offsets.len() + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n", offsets.len() + 1).as_bytes(),
    );

    out
}

#[test]
fn pdf_hits_carry_page_location() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    let pdf_bytes = make_pdf_full(&["alpha beta gamma delta", "epsilon sigma zeta eta"]);
    let p = books_root.join("b.pdf");
    fs::write(&p, &pdf_bytes).unwrap();
    add_book(&conn, "两页", "pdf", &p.to_string_lossy());
    build_index(dir.path(), &conn).unwrap();

    let hits = search(dir.path(), "gamma", 10).unwrap();
    assert!(!hits.is_empty(), "第一页文本应被索引");
    assert_eq!(hits[0].location, "1");
    assert_eq!(hits[0].format, "pdf");

    let hits2 = search(dir.path(), "sigma", 10).unwrap();
    assert!(!hits2.is_empty(), "第二页文本应被索引");
    assert_eq!(hits2[0].location, "2");

    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn delete_book_removes_from_index() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let books_root = dir.path().join("books");
    fs::create_dir(&books_root).unwrap();
    let a = books_root.join("a.txt");
    let b = books_root.join("b.txt");
    fs::write(&a, "甲书的漫长岁月").unwrap();
    fs::write(&b, "乙书的另一段漫长历史").unwrap();
    let id_a = add_book(&conn, "甲", "txt", &a.to_string_lossy());
    let id_b = add_book(&conn, "乙", "txt", &b.to_string_lossy());
    build_index(dir.path(), &conn).unwrap();

    assert!(search(dir.path(), "漫长", 10).unwrap().iter().any(|h| h.book_id == id_a as u64));
    assert!(search(dir.path(), "漫长", 10).unwrap().iter().any(|h| h.book_id == id_b as u64));

    delete_book_from_index(dir.path(), id_b).unwrap();

    let after = search(dir.path(), "漫长", 10).unwrap();
    assert!(after.iter().any(|h| h.book_id == id_a as u64));
    assert!(!after.iter().any(|h| h.book_id == id_b as u64));

    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn snippet_truncates_long_text() {
    let long = "前言部分。".repeat(200);
    let long = format!("{long}特殊关键词出现于此处。{long}");
    let s = yd_lib::search::snippet(&long, "特殊关键词", 40);
    assert!(s.contains("特殊关键词"));
    assert!(s.len() < long.len());
}
