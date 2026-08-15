# 阅读体验 R10：阅读统计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 记录书源书阅读时长/次数/最近阅读，书籍详情页展示。

**Architecture:** Rust `reading_stats` 表 + record_read/get_reading_stats 命令；前端 api 封装；ReaderPage 计时器（心跳 + 卸载 flush + 会话计数）；SourceBookPage 展示。

**Tech Stack:** Rust（rusqlite）+ React 19 + TypeScript + vitest。无新依赖。

## Global Constraints

- 仅书源书（书架在线书）统计；本地书不做（books.last_opened_at 已覆盖最近阅读）。
- 不做趋势图表、统计设置。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；Rust 测试 `cargo test`（src-tauri 目录）；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src-tauri/src/db.rs` | reading_stats 表 + record_read/get_reading_stats | 修改 |
| `src-tauri/src/commands.rs` | 2 个命令 | 修改 |
| `src-tauri/tests/db_test.rs` | 统计测试 | 修改 |
| `src/services/api.ts` | recordRead/getReadingStats | 修改 |
| `src/pages/ReaderPage.tsx` | 计时器 | 修改 |
| `src/pages/SourceBookPage.tsx` | 统计展示 | 修改 |

## 任务依赖

Task 1（Rust 后端）→ Task 2（api + ReaderPage 计时器）→ Task 3（SourceBookPage 展示）→ Task 4（验证）。

---

### Task 1: Rust 后端

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/db_test.rs`

- [ ] **Step 1: db.rs 表 + 结构 + 函数**

init_db 追加：

```sql
CREATE TABLE IF NOT EXISTS reading_stats (
    source_id INTEGER NOT NULL,
    book_url TEXT NOT NULL,
    title TEXT NOT NULL,
    read_seconds INTEGER NOT NULL DEFAULT 0,
    read_count INTEGER NOT NULL DEFAULT 0,
    last_read_at INTEGER,
    PRIMARY KEY (source_id, book_url)
);
```

结构体与函数：

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReadingStats {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub read_seconds: i64,
    pub read_count: i64,
    pub last_read_at: Option<i64>,
}

pub fn record_read(conn: &Connection, source_id: i64, book_url: &str, title: &str, seconds: i64, increment_count: bool) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO reading_stats (source_id, book_url, title, read_seconds, read_count, last_read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_id, book_url) DO UPDATE SET
           read_seconds = read_seconds + excluded.read_seconds,
           title = excluded.title,
           read_count = read_count + ?7,
           last_read_at = excluded.last_read_at",
        params![source_id, book_url, title, seconds, if increment_count { 1 } else { 0 }, t, if increment_count { 1 } else { 0 }],
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
```

注意 ON CONFLICT 的 `read_count + ?7`——SQLite 的 DO UPDATE 可用 excluded 与现有列。首次 INSERT 的 read_count = ?5（increment_count ? 1 : 0）。

- [ ] **Step 2: commands.rs**

```rust
#[tauri::command]
pub fn record_read(source_id: i64, book_url: String, title: String, seconds: i64, increment_count: bool, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::record_read(&state.db.lock().unwrap(), source_id, &book_url, &title, seconds, increment_count).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_reading_stats(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Option<crate::db::ReadingStats>, String> {
    crate::db::get_reading_stats(&state.db.lock().unwrap(), source_id, &book_url).map_err(|e| e.to_string())
}
```

注册 lib.rs。

- [ ] **Step 3: db_test.rs 测试**

```rust
#[test]
fn reading_stats_record_and_get() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let book = "https://ex.com/b/1.html";
    // 首次：会话 +1，时长 0
    record_read(&conn, 1, book, "三体", 0, true).unwrap();
    let s = get_reading_stats(&conn, 1, book).unwrap().unwrap();
    assert_eq!(s.read_count, 1);
    assert_eq!(s.read_seconds, 0);
    assert!(s.last_read_at.is_some());
    // 心跳：时长 +30
    record_read(&conn, 1, book, "三体", 30, false).unwrap();
    let s = get_reading_stats(&conn, 1, book).unwrap().unwrap();
    assert_eq!(s.read_seconds, 30);
    assert_eq!(s.read_count, 1);
    // 再次会话：count +1，时长累计
    record_read(&conn, 1, book, "三体", 0, true).unwrap();
    let s = get_reading_stats(&conn, 1, book).unwrap().unwrap();
    assert_eq!(s.read_count, 2);
    assert_eq!(s.read_seconds, 30);
    // 跨书隔离
    assert!(get_reading_stats(&conn, 1, "https://ex.com/b/2.html").unwrap().is_none());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 4: 运行确认通过**

Run（src-tauri）: `cargo test --test db_test`
Expected: 全绿（含新增 1）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/db_test.rs
git commit -m "feat: 阅读统计后端（reading_stats 表与命令）"
```

---

### Task 2: api + ReaderPage 计时器

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/pages/ReaderPage.tsx`
- Test: `src/pages/ReaderPage.source.test.tsx`

- [ ] **Step 1: api.ts 封装**

```ts
export interface ReadingStats {
  source_id: number; book_url: string; title: string;
  read_seconds: number; read_count: number; last_read_at: number | null;
}

export async function recordRead(a: { sourceId: number; bookUrl: string; title: string; seconds: number; incrementCount: boolean }): Promise<void> {
  await invoke("record_read", {
    sourceId: a.sourceId, bookUrl: a.bookUrl, title: a.title,
    seconds: a.seconds, incrementCount: a.incrementCount,
  });
}
export async function getReadingStats(sourceId: number, bookUrl: string): Promise<ReadingStats | null> {
  return invoke<ReadingStats | null>("get_reading_stats", { sourceId, bookUrl });
}
```

- [ ] **Step 2: ReaderPage 计时器**

```tsx
// ==== 书源：阅读统计计时 ====
useEffect(() => {
  if (isLocal) return;
  const t = { start: Date.now(), pending: 0 };
  void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: 0, incrementCount: true }).catch(() => {});
  const hb = window.setInterval(() => {
    const now = Date.now();
    const sec = Math.floor((now - t.start) / 1000) + t.pending;
    t.start = now; t.pending = 0;
    if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
  }, 30000);
  return () => {
    window.clearInterval(hb);
    const sec = Math.floor((Date.now() - t.start) / 1000) + t.pending;
    if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
  };
}, [isLocal, sourceId, bookUrl, bookTitle]);
```

- [ ] **Step 3: 测试（ReaderPage.source.test.tsx）**

api mock 补 `recordRead: vi.fn().mockResolvedValue(undefined)`。

```tsx
it("reports a read session on mount", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([
    { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
  ]);
  vi.mocked(api.httpGet).mockResolvedValue(ch1);
  renderReader();
  await screen.findByText("第一章正文内容。");
  await waitFor(() =>
    expect(api.recordRead).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 1, bookUrl: "https://ex.com/book/1.html", seconds: 0, incrementCount: true,
    })),
  );
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/ReaderPage.source.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/pages/ReaderPage.tsx src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 阅读页计时器与时长上报"
```

---

### Task 3: SourceBookPage 统计展示

**Files:**
- Modify: `src/pages/SourceBookPage.tsx`
- Test: `src/pages/SourceBookPage.test.tsx`

- [ ] **Step 1: 加载 + 格式化 + 展示**

```tsx
const [stats, setStats] = useState<ReadingStats | null>(null);
useEffect(() => {
  let cancelled = false;
  void getReadingStats(sourceId, bookUrl).then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
  return () => { cancelled = true; };
}, [sourceId, bookUrl]);

function formatReadTime(sec: number): string {
  const min = Math.floor(sec / 60);
  if (min < 1) return `${sec} 秒`;
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} 小时 ${min % 60} 分钟` : `${min} 分钟`;
}
function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

meta 区（info.author 旁）：

```tsx
{stats && stats.read_seconds > 0 && (
  <span className="hit-author">
    {formatReadTime(stats.read_seconds)} · 阅读 {stats.read_count} 次{stats.last_read_at ? ` · 最近 ${formatDate(stats.last_read_at)}` : ""}
  </span>
)}
```

- [ ] **Step 2: 测试（SourceBookPage.test.tsx）**

api mock 补 `getReadingStats: vi.fn().mockResolvedValue(null)`；新增用例 mock 返回统计 → 断言展示。

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/pages/SourceBookPage.tsx src/pages/SourceBookPage.test.tsx
git commit -m "feat: 书籍详情页阅读统计展示"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 ReaderPage 会话、SourceBookPage 展示）

- [ ] **Step 2: Rust 全量测试**

Run（src-tauri）: `cargo test`
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 终审清单**

- [ ] Rust：表 + 2 函数 + 2 命令 + 1 测试 ✓
- [ ] api.ts 2 封装 ✓
- [ ] ReaderPage 计时器 + 会话上报 ✓
- [ ] SourceBookPage 统计展示 ✓
- [ ] `npm test`、`cargo test`、`npm run build` 全绿、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 阅读统计终审修复`）。

- [ ] **Step 5: Commit（若终审有修复）**

```bash
git commit -am "fix: 阅读统计终审修复"
```

---
