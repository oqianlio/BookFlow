# 复刻 legado 阅读体验 R10：阅读统计

日期：2026-08-15
状态：待批准
前置：R9 完成。

## 1. 目标

记录书源书的阅读行为：累计阅读时长（秒）、最近阅读时间、阅读次数；在书籍详情页展示。本地书可后续扩展（本批聚焦书源书 + 书架在线书）。

## 2. 背景与问题

legado 有「阅读统计」：每本书的阅读时长、最近阅读、读完进度。当前枕书只有 `book_source_progress`（章节进度 + updated_at），无累计时长与阅读次数。

## 3. 非目标

- 不做按天/按周趋势图表（仅累计展示）。
- 不做本地书统计（books 表已有 last_opened_at，可作最近阅读）。
- 不做统计设置（开关/重置）。

## 4. 架构

```
reading_stats 表（新，Rust db.rs）
  source_id, book_url, title,
  read_seconds INTEGER NOT NULL DEFAULT 0,   -- 累计阅读秒
  read_count INTEGER NOT NULL DEFAULT 0,     -- 打开次数
  last_read_at INTEGER,                      -- 最近阅读时间戳
  PRIMARY KEY (source_id, book_url)

后端命令（commands.rs）：
  record_read(sourceId, bookUrl, title, seconds)   -- 追加时长 + 更新 last_read_at + read_count(首次)
  get_reading_stats(sourceId, bookUrl)             -- 返回统计

前端：
  api.ts：recordRead / getReadingStats 封装
  ReaderPage：阅读计时器（进入章节开始计时，离开/切章/卸载时上报增量秒）
    - 简单策略：每 30s 心跳上报一次（累计计时，卸载时 flush）
  SourceBookPage：详情区展示统计（已读 X 分钟 · 阅读 N 次 · 最近 xx）
```

### 4.1 数据库（db.rs）

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

函数：

```rust
pub struct ReadingStats {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub read_seconds: i64,
    pub read_count: i64,
    pub last_read_at: Option<i64>,
}

pub fn record_read(conn, source_id, book_url, title, seconds: i64) -> Result<()> {
    // UPSERT：read_seconds += seconds，last_read_at = now，
    // read_count：首次插入为 1，否则不变（用 SQL：INSERT ... ON CONFLICT DO UPDATE SET read_seconds=read_seconds+excluded... ）
    // 首次 read_count=1 需区分：INSERT 时 read_count=1，冲突时不加
}

pub fn get_reading_stats(conn, source_id, book_url) -> Result<Option<ReadingStats>>;
```

UPSERT 语义：`INSERT (source_id, book_url, title, read_seconds, read_count, last_read_at) VALUES (?,?,?,?,1,now) ON CONFLICT(source_id, book_url) DO UPDATE SET read_seconds = read_seconds + excluded.read_seconds, title = excluded.title, last_read_at = excluded.last_read_at`——首次插入 read_count=1，冲突更新不加 read_count（保持 1？**不对**，read_count 应每次"打开阅读会话"加 1）。

**read_count 语义**：前端每次进入 ReaderPage（新会话）调用 `recordRead(seconds=0)` 并带 `incCount=true`？更简单：分开两个动作：
- `recordReadSeconds(source_id, book_url, title, seconds)` — 时长心跳（只加 read_seconds + last_read_at）
- `recordReadSession(source_id, book_url, title)` — 会话计数（read_count += 1 + last_read_at）

**简化**：一个命令 `record_read(source_id, book_url, title, seconds, increment_count: bool)`：
- INSERT 时 read_seconds=seconds, read_count = increment_count ? 1 : 0, last_read_at=now
- ON CONFLICT UPDATE：read_seconds += excluded.read_seconds, last_read_at = excluded.last_read_at, read_count = read_count + (increment_count ? 1 : 0)

前端：ReaderPage 挂载时 `record_read(seconds=0, increment_count=true)`（会话+1），每 30s 心跳 `record_read(seconds=30, increment_count=false)`，卸载 flush 剩余秒。

### 4.2 前端计时器（ReaderPage）

```ts
const statsTimer = useRef<{ start: number; pending: number } | null>(null);

// 挂载/进入章节开始计时（书源路径）
useEffect(() => {
  if (isLocal) return;
  statsTimer.current = { start: Date.now(), pending: 0 };
  void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: 0, incrementCount: true }).catch(() => {});
  const hb = window.setInterval(() => {
    const t = statsTimer.current;
    if (!t) return;
    const now = Date.now();
    const sec = Math.floor((now - t.start) / 1000) + t.pending;
    t.start = now; t.pending = 0;
    if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
  }, 30000);
  return () => {
    window.clearInterval(hb);
    const t = statsTimer.current;
    if (t) {
      const sec = Math.floor((Date.now() - t.start) / 1000) + t.pending;
      if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
    }
  };
}, [isLocal, sourceId, bookUrl, bookTitle]);
```

### 4.3 展示（SourceBookPage）

- 详情区加载 `getReadingStats(sourceId, bookUrl)`（失败静默）。
- 展示（info 下小字）：`已读 X 分钟 · 阅读 N 次 · 最近 {date}`（秒 → 分钟；无数据显示占位）。

```tsx
const [stats, setStats] = useState<ReadingStats | null>(null);
useEffect(() => {
  let cancelled = false;
  void getReadingStats(sourceId, bookUrl).then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
  return () => { cancelled = true; };
}, [sourceId, bookUrl]);

{stats && stats.read_seconds > 0 && (
  <span className="hit-author">
    {formatReadTime(stats.read_seconds)} · 阅读 {stats.read_count} 次{stats.last_read_at ? ` · 最近 ${formatDate(stats.last_read_at)}` : ""}
  </span>
)}
```

`formatReadTime`/`formatDate` 工具放 readingStats.ts 或内联（放 `src/services/readingStats.ts` 前端封装 + 格式化）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/db.rs` | reading_stats 表 + record_read/get_reading_stats |
| `src-tauri/src/commands.rs` | record_read / get_reading_stats 命令 |
| `src-tauri/tests/db_test.rs` | 统计测试 |
| `src/services/api.ts` | recordRead/getReadingStats 封装 |
| `src/services/readingStats.ts` | 前端格式化工具（可选，或内联） |
| `src/pages/ReaderPage.tsx` | 计时器 |
| `src/pages/SourceBookPage.tsx` | 统计展示 |
| 各测试文件 | 适配 |

## 6. 测试

- Rust：record_read 首次插入 read_count=1、多次时长累加、increment_count 会话计数、last_read_at 更新、get 返回。
- ReaderPage：计时器心跳上报（fake timers）、卸载 flush、会话计数。
- SourceBookPage：统计展示（mock getReadingStats）。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 7. 错误处理

- 统计上报失败 → 静默（不阻塞阅读）。
- 计时器在无网络时仍本地计时，心跳失败不重试（下个心跳补）。
- get_reading_stats 无记录 → null（前端不展示）。
