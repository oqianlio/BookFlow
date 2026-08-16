//! 开发者日志：前端错误/警告经 log_frontend 写入应用数据目录的日志文件，
//! 提供 read_logs / clear_logs 供设置页「开发者日志」面板查看与清空。

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// 日志文件路径（应用数据目录/logs/app.log）
pub fn log_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs").join("app.log")
}

/// 追加一条日志（时间戳 + 级别 + 消息）。目录不存在时自动创建；写失败静默忽略。
pub fn append_log(app_data_dir: &Path, level: &str, message: &str) {
    let path = log_file_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let ts = chrono_like_timestamp();
    let line = format!("[{ts}] [{level}] {message}\n");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Rust 侧日志：与前端日志同文件，带 `[rust]` 来源标记（F1 统一日志）。
pub fn rust_log(app_data_dir: &Path, level: &str, message: &str) {
    append_log(app_data_dir, level, &format!("[rust] {message}"));
}

/// 读取日志尾部最多 limit 行（从后往前读，保持顺序）。文件不存在时返回空。
pub fn read_logs(app_data_dir: &Path, limit: usize) -> Vec<String> {
    let path = log_file_path(app_data_dir);
    if !path.is_file() {
        return Vec::new();
    }
    let mut f = match OpenOptions::new().read(true).open(&path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..].iter().map(|s| s.to_string()).collect()
}

/// 清空日志文件
pub fn clear_logs(app_data_dir: &Path) {
    let path = log_file_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let _ = OpenOptions::new().create(true).write(true).truncate(true).open(&path);
}

/// 读取日志文件总大小（字节），供面板显示
pub fn log_file_size(app_data_dir: &Path) -> u64 {
    fs::metadata(log_file_path(app_data_dir)).map(|m| m.len()).unwrap_or(0)
}

/// 无外部依赖的时间戳（YYYY-MM-DD HH:MM:SS，本地时区）。
/// 避免为日志引入 chrono 依赖；UTC+8 固定偏移即可满足调试需求。
fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() + 8 * 3600; // UTC+8
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // 1970-01-01 起的天数 → 年月日（civil 算法）
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}")
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试独立子目录，避免残留干扰
    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("yd_logs_test_{}_{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn append_read_clear_roundtrip() {
        let dir = tmp_dir("roundtrip");
        append_log(&dir, "error", "boom message");
        append_log(&dir, "info", "hello");
        let logs = read_logs(&dir, 10);
        assert_eq!(logs.len(), 2);
        assert!(logs[0].contains("[error] boom message"));
        assert!(logs[0].contains("[2026-"));
        assert!(logs[1].contains("[info] hello"));
        assert!(log_file_size(&dir) > 0);
        clear_logs(&dir);
        assert_eq!(read_logs(&dir, 10).len(), 0);
    }

    #[test]
    fn read_logs_limits_to_tail() {
        let dir = tmp_dir("tail");
        for i in 0..5 {
            append_log(&dir, "info", &format!("line {i}"));
        }
        let tail = read_logs(&dir, 2);
        assert_eq!(tail.len(), 2);
        assert!(tail[0].contains("line 3"));
        assert!(tail[1].contains("line 4"));
    }

    #[test]
    fn read_logs_missing_file_is_empty() {
        let dir = tmp_dir("missing");
        assert!(read_logs(&dir, 10).is_empty());
    }
}
