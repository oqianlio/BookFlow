// 临时工具：导出已启用的书源列表（供前端书源健康检查脚本使用）
use rusqlite::Connection;

fn main() {
    let db = std::env::args().nth(1).unwrap_or_else(|| {
        r"C:\Users\Administrator\AppData\Roaming\com.administrator.yd\reader.db".to_string()
    });
    let out = std::env::args().nth(2).unwrap_or_else(|| r"C:\gc\yd\tmp_sources.json".to_string());
    let conn = Connection::open(&db).expect("open db");
    let mut stmt = conn
        .prepare("SELECT id, name, url, json, enabled FROM book_sources ORDER BY name")
        .expect("prepare");
    let rows: Vec<(i64, String, String, String, bool)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("collect");
    let arr: Vec<serde_json::Value> = rows
        .iter()
        .filter(|(_, _, _, _, enabled)| *enabled)
        .map(|(id, name, url, json, _)| {
            serde_json::json!({ "id": id, "name": name, "url": url, "json": json })
        })
        .collect();
    std::fs::write(&out, serde_json::to_string_pretty(&arr).expect("serialize")).expect("write");
    eprintln!("exported {} enabled sources (of {} total)", arr.len(), rows.len());
}
