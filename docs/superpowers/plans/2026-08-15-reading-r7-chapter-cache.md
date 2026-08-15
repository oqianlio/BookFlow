# 阅读体验 R7：章节缓存 / 离线下载 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整本书章节正文缓存到本地 SQLite，离线可读；阅读优先读缓存；书籍页提供「缓存全书」按钮与进度展示。

**Architecture:** Rust 新增 `chapter_cache` 表与 4 个命令（save/list/get/delete）；前端 api.ts 封装；`src/services/chapterCache.ts` 下载状态机（复用前端规则引擎）；SourceBookPage 缓存入口；ReaderPage 优先读缓存。

**Tech Stack:** Rust（rusqlite）+ React 19 + TypeScript + vitest。无新依赖。

## Global Constraints

- 章节抓取/净化在前端（复用 bookSourceEngine 规则引擎），Rust 仅存储。
- 不做图片/封面缓存、缓存管理 UI、TTS 联动。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；Rust 测试 `cargo test`（src-tauri 目录）；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src-tauri/src/db.rs` | chapter_cache 表 + 4 函数 | 修改 |
| `src-tauri/src/commands.rs` | 4 个命令 | 修改 |
| `src-tauri/tests/db_test.rs` | 缓存表测试 | 修改 |
| `src/services/api.ts` | 4 个封装 | 修改 |
| `src/services/chapterCache.ts` | downloadBook 状态机 | 新建 |
| `src/services/chapterCache.test.ts` | 下载/断点/降级测试 | 新建 |
| `src/pages/SourceBookPage.tsx` | 缓存按钮 + 进度 | 修改 |
| `src/pages/ReaderPage.tsx` | loadChapter 优先读缓存 | 修改 |

## 任务依赖

Task 1（Rust 后端）→ Task 2（api.ts + chapterCache 服务）→ Task 3（SourceBookPage 入口）→ Task 4（ReaderPage 读缓存）→ Task 5（全量验证）。

---

### Task 1: Rust 后端

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/db_test.rs`

- [ ] **Step 1: db.rs 表 + 结构 + 函数**

init_db 追加：

```sql
CREATE TABLE IF NOT EXISTS chapter_cache (
    source_id INTEGER NOT NULL,
    book_url TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    chapter_url TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, book_url, chapter_url)
);
```

结构体与函数：

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct CachedChapter {
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewCachedChapter {
    pub source_id: i64,
    pub book_url: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub content: String,
}

pub fn save_cached_chapter(conn: &Connection, c: &NewCachedChapter) -> Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO chapter_cache (source_id, book_url, chapter_index, chapter_url, chapter_name, content, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source_id, book_url, chapter_url) DO UPDATE SET
           chapter_index = excluded.chapter_index,
           chapter_name = excluded.chapter_name,
           content = excluded.content,
           updated_at = excluded.updated_at",
        params![c.source_id, c.book_url, c.chapter_index, c.chapter_url, c.chapter_name, c.content, t],
    )?;
    Ok(())
}

pub fn list_cached_chapters(conn: &Connection, source_id: i64, book_url: &str) -> Result<Vec<CachedChapter>> {
    let mut stmt = conn.prepare(
        "SELECT chapter_index, chapter_url, chapter_name, updated_at FROM chapter_cache
         WHERE source_id = ?1 AND book_url = ?2 ORDER BY chapter_index",
    )?;
    let rows = stmt.query_map(params![source_id, book_url], |r| {
        Ok(CachedChapter {
            chapter_index: r.get(0)?, chapter_url: r.get(1)?,
            chapter_name: r.get(2)?, updated_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn get_cached_chapter(conn: &Connection, source_id: i64, book_url: &str, chapter_url: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT content FROM chapter_cache WHERE source_id = ?1 AND book_url = ?2 AND chapter_url = ?3",
    )?;
    let mut rows = stmt.query(params![source_id, book_url, chapter_url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(r.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn delete_book_cache(conn: &Connection, source_id: i64, book_url: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM chapter_cache WHERE source_id = ?1 AND book_url = ?2",
        params![source_id, book_url],
    )?;
    Ok(())
}
```

- [ ] **Step 2: commands.rs 四个命令**

```rust
#[derive(serde::Deserialize)]
pub struct CachedChapterInput {
    pub source_id: i64,
    pub book_url: String,
    pub chapter_index: i64,
    pub chapter_url: String,
    pub chapter_name: String,
    pub content: String,
}

#[tauri::command]
pub fn save_cached_chapter(input: CachedChapterInput, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::save_cached_chapter(&state.db.lock().unwrap(), &crate::db::NewCachedChapter {
        source_id: input.source_id, book_url: input.book_url,
        chapter_index: input.chapter_index, chapter_url: input.chapter_url,
        chapter_name: input.chapter_name, content: input.content,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_cached_chapters(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<Vec<crate::db::CachedChapter>, String> {
    crate::db::list_cached_chapters(&state.db.lock().unwrap(), source_id, &book_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cached_chapter(source_id: i64, book_url: String, chapter_url: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    crate::db::get_cached_chapter(&state.db.lock().unwrap(), source_id, &book_url, &chapter_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_book_cache(source_id: i64, book_url: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::delete_book_cache(&state.db.lock().unwrap(), source_id, &book_url).map_err(|e| e.to_string())
}
```

注册到 lib.rs invoke_handler。

- [ ] **Step 3: db_test.rs 测试**

```rust
#[test]
fn chapter_cache_roundtrip_and_upsert() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "示例", "https://ex.com", "{}").unwrap();
    let book = "https://ex.com/b/1.html";
    save_cached_chapter(&conn, &NewCachedChapter {
        source_id: sid, book_url: book.into(), chapter_index: 0,
        chapter_url: "https://ex.com/c/1.html".into(), chapter_name: "第一章".into(),
        content: "<p>正文一</p>".into(),
    }).unwrap();
    save_cached_chapter(&conn, &NewCachedChapter {
        source_id: sid, book_url: book.into(), chapter_index: 1,
        chapter_url: "https://ex.com/c/2.html".into(), chapter_name: "第二章".into(),
        content: "<p>正文二</p>".into(),
    }).unwrap();
    // UPSERT：同章节重复保存更新内容
    save_cached_chapter(&conn, &NewCachedChapter {
        source_id: sid, book_url: book.into(), chapter_index: 0,
        chapter_url: "https://ex.com/c/1.html".into(), chapter_name: "第一章".into(),
        content: "<p>正文一 v2</p>".into(),
    }).unwrap();
    let list = list_cached_chapters(&conn, sid, book).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(get_cached_chapter(&conn, sid, book, "https://ex.com/c/1.html").unwrap().unwrap(), "<p>正文一 v2</p>");
    // 跨书隔离
    assert!(get_cached_chapter(&conn, sid, "https://ex.com/b/2.html", "https://ex.com/c/1.html").unwrap().is_none());
    // 删除整本
    delete_book_cache(&conn, sid, book).unwrap();
    assert!(list_cached_chapters(&conn, sid, book).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 4: 运行确认通过**

Run（src-tauri 目录）: `cargo test --test db_test`
Expected: 全绿（含新增 1）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/db_test.rs
git commit -m "feat: 章节缓存后端（chapter_cache 表与命令）"
```

---

### Task 2: api.ts + chapterCache 服务

**Files:**
- Modify: `src/services/api.ts`
- Create: `src/services/chapterCache.ts`
- Test: `src/services/chapterCache.test.ts`

- [ ] **Step 1: api.ts 追加**

```ts
export async function saveCachedChapter(c: { sourceId: number; bookUrl: string; chapterIndex: number; chapterUrl: string; chapterName: string; content: string }): Promise<void> {
  await invoke("save_cached_chapter", {
    input: {
      sourceId: c.sourceId, bookUrl: c.bookUrl, chapterIndex: c.chapterIndex,
      chapterUrl: c.chapterUrl, chapterName: c.chapterName, content: c.content,
    },
  });
}
export async function listCachedChapters(sourceId: number, bookUrl: string): Promise<Array<{ chapter_index: number; chapter_url: string; chapter_name: string; updated_at: number }>> {
  return invoke("list_cached_chapters", { sourceId, bookUrl });
}
export async function getCachedChapter(sourceId: number, bookUrl: string, chapterUrl: string): Promise<string | null> {
  return invoke<string | null>("get_cached_chapter", { sourceId, bookUrl, chapterUrl });
}
export async function deleteBookCache(sourceId: number, bookUrl: string): Promise<void> {
  await invoke("delete_book_cache", { sourceId, bookUrl });
}
```

- [ ] **Step 2: chapterCache.ts**

```ts
import { httpGet, mergeUserAgent, saveCachedChapter, listCachedChapters } from "./api";
import { parseHtml, extractSingle, purifyContent, type BookSource as Src } from "./bookSourceEngine";
import type { TocItem } from "./sourceToc";

export interface DownloadProgress { done: number; total: number; failed: number }

export interface DownloadOpts {
  sourceId: number;
  bookUrl: string;
  toc: TocItem[];
  getSrc: () => Promise<Src>;
  onProgress: (p: DownloadProgress) => void;
  signal?: { cancelled: boolean };
}

export async function downloadBook(opts: DownloadOpts): Promise<DownloadProgress> {
  const src = await opts.getSrc();
  let cookieJarHost = "";
  try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
  const cached = new Set((await listCachedChapters(opts.sourceId, opts.bookUrl)).map((c) => c.chapter_url));
  const pending = opts.toc.filter((t) => !cached.has(t.url));
  const total = opts.toc.length;
  let done = total - pending.length;
  let failed = 0;
  for (const t of pending) {
    if (opts.signal?.cancelled) break;
    try {
      const html = await httpGet(t.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
      const doc = parseHtml(html);
      const rules = src.ruleContent ?? {};
      const text = await extractSingle(doc, rules.content ?? "body", { baseUrl: t.url, result: html, sourceKey: src.bookSourceUrl });
      await saveCachedChapter({
        sourceId: opts.sourceId, bookUrl: opts.bookUrl,
        chapterIndex: opts.toc.findIndex((x) => x.url === t.url),
        chapterUrl: t.url, chapterName: t.name,
        content: purifyContent(text, (src as any).purify),
      });
      done += 1;
    } catch {
      failed += 1;
    }
    opts.onProgress({ done, total, failed });
  }
  opts.onProgress({ done, total, failed });
  return { done, total, failed };
}
```

注意：`chapterIndex` 用 `opts.toc.findIndex(x => x.url === t.url)`（与 toc 一致）。

- [ ] **Step 3: chapterCache.test.ts**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import * as bookSourceEngine from "./bookSourceEngine";
import { downloadBook } from "./chapterCache";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  mergeUserAgent: (h?: Record<string, string>, ua?: string) => (ua ? { ...(h ?? {}), "User-Agent": ua } : h),
  saveCachedChapter: vi.fn().mockResolvedValue(undefined),
  listCachedChapters: vi.fn().mockResolvedValue([]),
}));

// 用真实 bookSourceEngine（jsdom 可跑 extractSingle），不 mock

const src = {
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  httpUserAgent: "UA",
  ruleContent: { content: "#content" },
} as any;

const toc = [
  { name: "第一章", url: "https://ex.com/c/1.html" },
  { name: "第二章", url: "https://ex.com/c/2.html" },
];

beforeEach(() => vi.clearAllMocks());

describe("downloadBook", () => {
  it("downloads all chapters and reports progress", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const onProgress = vi.fn();
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress });
    expect(r.done).toBe(2);
    expect(r.failed).toBe(0);
    expect(api.saveCachedChapter).toHaveBeenCalledTimes(2);
    expect(api.saveCachedChapter).toHaveBeenCalledWith(expect.objectContaining({ chapterName: "第一章", content: expect.stringContaining("正文") }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ done: 2, total: 2 }));
  });

  it("skips already cached chapters (resume)", async () => {
    vi.mocked(api.listCachedChapters).mockResolvedValue([
      { chapter_index: 0, chapter_url: "https://ex.com/c/1.html", chapter_name: "第一章", updated_at: 1 },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {} });
    expect(api.httpGet).toHaveBeenCalledTimes(1);  // 只抓第二章
    expect(r.done).toBe(2);
  });

  it("continues when a single chapter fails", async () => {
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url.endsWith("1.html")) throw new Error("网络错误");
      return `<html><body><div id="content"><p>正文二</p></div></body></html>`;
    });
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {} });
    expect(r.failed).toBe(1);
    expect(r.done).toBe(1);
  });

  it("stops when cancelled", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const signal = { cancelled: false };
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {}, signal });
    // 先跑完一次验证，再测取消：在 getSrc 返回前取消
    signal.cancelled = true;
    const r2 = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {}, signal });
    expect(r2.done).toBe(0);
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/chapterCache.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/services/chapterCache.ts src/services/chapterCache.test.ts
git commit -m "feat: 章节缓存下载服务（chapterCache）"
```

---

### Task 3: SourceBookPage 缓存入口

**Files:**
- Modify: `src/pages/SourceBookPage.tsx`
- Test: `src/pages/SourceBookPage.test.tsx`

- [ ] **Step 1: 状态与下载**

```tsx
const [dl, setDl] = useState<{ busy: boolean; done: number; total: number; failed: number }>({ busy: false, done: 0, total: 0, failed: 0 });
const dlSignalRef = useRef({ cancelled: false });

const handleDownload = async () => {
  if (dl.busy || toc.length === 0) return;
  dlSignalRef.current = { cancelled: false };
  setDl({ busy: true, done: 0, total: toc.length, failed: 0 });
  try {
    const bs = (await import("../services/api")).listBookSources;
    const row = (await bs()).find((x) => x.id === sourceId);
    if (!row) { showError("书源不存在"); setDl((p) => ({ ...p, busy: false })); return; }
    const src = parseBookSourceJson(row.json);
    await downloadBook({
      sourceId, bookUrl, toc,
      getSrc: async () => src,
      onProgress: (p) => setDl({ busy: true, done: p.done, total: p.total, failed: p.failed }),
      signal: dlSignalRef.current,
    });
  } catch (e) {
    showError(String(e));
  } finally {
    setDl((p) => ({ ...p, busy: false }));
  }
};

// 卸载取消
useEffect(() => () => { dlSignalRef.current.cancelled = true; }, []);
```

- 需要从 fetchToc 拿到 toc 与书源——fetchToc 返回 toc 但不返回书源对象。改为在 handleDownload 里 `listBookSources` + `parseBookSourceJson` 取 src（见上）。

- [ ] **Step 2: 按钮渲染（source-book-actions 内）**

```tsx
<button className="btn btn-ghost" onClick={handleDownload} disabled={dl.busy || toc.length === 0}>
  {dl.busy ? `缓存中 ${dl.done}/${dl.total}` : dl.total > 0 && dl.done === dl.total ? `已缓存 ${dl.total} 章` : "缓存全书"}
</button>
```

（done/total 初始 0；下载完成后按钮显示已缓存。失败章节>0 时 showError 提示 `部分失败 ${dl.failed} 章`。）

- [ ] **Step 3: 测试**

- SourceBookPage.test.tsx：mock chapterCache.downloadBook 或走真实 + mock api（走真实更佳，mock api.httpGet/saveCachedChapter/listCachedChapters），断言：点缓存按钮 → downloadBook 调用 → 完成后按钮变「已缓存 N 章」。

- [ ] **Step 4: Commit**

```bash
git add src/pages/SourceBookPage.tsx src/pages/SourceBookPage.test.tsx
git commit -m "feat: 书籍页缓存全书入口与进度"
```

---

### Task 4: ReaderPage 优先读缓存

**Files:**
- Modify: `src/pages/ReaderPage.tsx`
- Test: `src/pages/ReaderPage.source.test.tsx`

- [ ] **Step 1: loadChapter 缓存优先**

在现有 loadChapter 的 `httpGet` 前加缓存查询：

```tsx
const cached = await getCachedChapter(sourceId, c.url, c.url);
if (cached) {
  setContent(purifyContent(cached, (src as any)?.purify));  // 缓存已是净化后内容，直接 setContent(cached) 即可
  setLoading(false);
  return;
}
```

**注意**：缓存内容已是 `purifyContent` 后的纯文本/HTML，直接 `setContent(cached)`，不再二次净化（避免 `##` 替换规则重复应用）。但 isImageChapter 判断仍需？缓存章节是正文文本（下载时已处理），漫画章节下载时 content 为图片 URL 列表——**本批缓存仅文本章节**：downloadBook 保存的是 purifyContent 后的文本，漫画章节（isImageChapter）跳过或缓存失败。ReaderPage 缓存路径仅用于文本章节。

实现：

```tsx
try {
  const cached = await getCachedChapter(sourceId, c.url, c.url);
  if (cached) {
    setContent(cached);
    setLoading(false);
    return;
  }
  // ...现有在线抓取
}
```

- 漫画章节：缓存读取路径不适用（getCachedChapter 返回 null → 走在线）。

- [ ] **Step 2: 测试**

- ReaderPage.source.test.tsx：mock `getCachedChapter` 返回内容 → httpGet 不被调用，正文直接渲染；mock 返回 null → 走在线（现有用例已覆盖）。

- [ ] **Step 3: Commit**

```bash
git add src/pages/ReaderPage.tsx src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 阅读页优先读章节缓存"
```

---

### Task 5: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 chapterCache 4、SourceBookPage/ReaderPage 缓存用例）

- [ ] **Step 2: Rust 全量测试**

Run（src-tauri 目录）: `cargo test`
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 终审清单**

- [ ] Rust：表 + 4 函数 + 4 命令 + 1 测试 ✓
- [ ] api.ts 4 封装 ✓
- [ ] chapterCache 下载状态机 + 4 测试 ✓
- [ ] SourceBookPage 缓存按钮/进度 ✓
- [ ] ReaderPage 缓存优先读取 ✓
- [ ] `npm test`、`cargo test`、`npm run build` 全绿、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 章节缓存终审修复`）。

- [ ] **Step 5: Commit（若终审有修复）**

```bash
git commit -am "fix: 章节缓存终审修复"
```

---
