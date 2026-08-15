# 复刻 legado 阅读体验 R7：章节缓存 / 离线下载

日期：2026-08-15
状态：待批准
前置：R1-R6 完成。

## 1. 目标

整本书的章节正文可缓存到本地（SQLite），支持离线阅读；阅读页优先读缓存，离线时无需联网。提供「缓存全书」下载入口与下载进度展示。

## 2. 背景与问题

当前书源书逐章在线抓取，离线不可读；阅读体验依赖网络。legado 的「缓存到书架」是核心能力：一键缓存全书，之后断网也能读。

## 3. 非目标

- 不做缓存图片/封面（仅正文 HTML 文本缓存）。
- 不做多书源缓存（缓存属于特定 source_id + book_url）。
- 不做缓存管理 UI（清除缓存/缓存大小统计）——后续迭代。
- 不做 TTS 朗读缓存的联动。

## 4. 架构

```
chapter_cache 表（新，Rust db.rs）
  source_id, book_url, chapter_index, chapter_url, chapter_name,
  content TEXT, updated_at INTEGER,
  PRIMARY KEY (source_id, book_url, chapter_url)

后端命令（commands.rs）：
  download_book_chapters(sourceId, bookUrl, chapterUrls: [{index, url, name}]) → 逐章抓取正文并写缓存
    - 逐章 httpGet（书源 UA/cookieJar）→ ruleContent 提取 → purify → 写表
    - 返回 { done, failed, total }（断点续传：已缓存的章节跳过）
  list_cached_chapters(sourceId, bookUrl) → [{index, url, name, updated_at}]
  get_cached_chapter(sourceId, bookUrl, chapterUrl) → content | null
  delete_book_cache(sourceId, bookUrl) → 清除整本缓存

前端：
  api.ts：四个命令封装
  src/services/chapterCache.ts：下载任务状态机（进度回调），供书籍页/阅读页复用
  SourceBookPage：书籍信息区「缓存全书」按钮 + 下载进度（n/total）
  ReaderPage：加载章节时先查缓存 → 命中直接用，未命中在线抓取并（可选）写缓存
  SettingsPage（可选）：离线模式开关（默认自动：有缓存读缓存，无缓存在线）
```

### 4.1 数据库（db.rs）

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

函数：
- `save_cached_chapter(conn, c: &NewCachedChapter) -> Result<()>`（UPSERT）
- `list_cached_chapters(conn, source_id, book_url) -> Result<Vec<CachedChapter>>`
- `get_cached_chapter(conn, source_id, book_url, chapter_url) -> Result<Option<String>>`
- `delete_book_cache(conn, source_id, book_url) -> Result<()>`

### 4.2 下载命令（commands.rs）

```rust
#[derive(serde::Deserialize)]
pub struct ChapterRef { pub index: i64, pub url: String, pub name: String }

#[tauri::command]
pub async fn download_book_chapters(
    source_id: i64,
    book_url: String,
    chapter_urls: Vec<ChapterRef>,
    app: tauri::AppHandle,
) -> Result<DownloadResult, String>;

#[derive(serde::Serialize)]
pub struct DownloadResult { pub done: i64, pub failed: i64, pub total: i64 }
```

- 逐章处理：查缓存命中则跳过（断点续传）；未命中则 httpGet → 提取正文（复用前端规则？**不行**——规则引擎在前端 TS。方案：下载命令只负责 httpGet 拿 HTML 并返回给前端，由前端提取正文后写缓存。**重新设计**：下载逻辑放前端，Rust 只提供缓存读写命令 + httpGet。这样规则引擎复用，避免 Rust 重写 JS 规则。）

**修正架构**：章节抓取/净化在**前端**（复用 bookSourceEngine），Rust 仅提供 `save_cached_chapter / list_cached_chapters / get_cached_chapter / delete_book_cache` 四个命令。下载流程：

```
前端 chapterCache.ts：
  downloadBook({ sourceId, bookUrl, toc, src, onProgress }) 
    for each toc item:
      if cached (list_cached_chapters 命中) → skip
      html = await httpGet(chapter.url, ...)   // 前端直接调（复用现有 loadChapter 逻辑）
      content = extract + purify
      await saveCachedChapter({ sourceId, bookUrl, index, url, name, content })
      onProgress(done, total)
```

优点：规则引擎/净化完全复用前端实现；Rust 只做存储，职责清晰，测试简单。

### 4.3 前端 api.ts

```ts
export async function saveCachedChapter(c: { sourceId: number; bookUrl: string; chapterIndex: number; chapterUrl: string; chapterName: string; content: string }): Promise<void>;
export async function listCachedChapters(sourceId: number, bookUrl: string): Promise<Array<{ chapter_url: string; chapter_name: string; chapter_index: number; updated_at: number }>>;
export async function getCachedChapter(sourceId: number, bookUrl: string, chapterUrl: string): Promise<string | null>;
export async function deleteBookCache(sourceId: number, bookUrl: string): Promise<void>;
```

### 4.4 前端缓存服务（src/services/chapterCache.ts）

```ts
export interface DownloadProgress { done: number; total: number; failed: number }

export async function downloadBook(opts: {
  sourceId: number;
  bookUrl: string;
  toc: TocItem[];
  getSrc: () => Promise<Src>;      // 书源（含规则）
  onProgress: (p: DownloadProgress) => void;
  signal?: { cancelled: boolean };  // 取消标记
}): Promise<DownloadProgress>;
```

- 下载前 `listCachedChapters` 拿已缓存集合，跳过命中项。
- 逐章：`httpGet(url, UA, ..., cookieJar)` → `parseHtml` → `extractSingle(content rule)` → `purifyContent` → `saveCachedChapter`。
- 每章完成回调 onProgress。
- 单章失败：failed+1 继续（不中断整本）。
- 支持取消（signal.cancelled 检查）。

### 4.5 阅读优先读缓存（ReaderPage）

loadChapter 改流程：

```
1. 先 getCachedChapter(sourceId, bookUrl, c.url)
2. 命中 → 直接用缓存 content（不联网），isFromCache = true
3. 未命中 → 现有在线抓取流程
```

- 顶部可显示「已缓存」小徽标（可选，本批先不加 UI，只改读取路径）。
- 离线场景：缓存命中即正常读；未命中显示现有失败重试。

### 4.6 下载入口与进度（SourceBookPage）

- 书籍信息区「缓存全书」按钮（加入书架/换源旁）。
- 点击 → 用现有 toc + fetchToc 的 src（或重新解析书源）调 downloadBook。
- state：`{ downloading: boolean; done: number; total: number; failed: number }`。
- 进度展示：按钮文案变「缓存中 done/total」；完成变「已缓存 N 章」。
- 失败章节 > 0：完成后提示「部分失败 N 章」（showError 或按钮内提示）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/db.rs` | chapter_cache 表 + 4 函数 |
| `src-tauri/src/commands.rs` | 4 个命令 |
| `src-tauri/tests/db_test.rs` | 缓存表测试 |
| `src/services/api.ts` | 4 个封装 |
| `src/services/chapterCache.ts` | 新建：downloadBook 状态机 |
| `src/services/chapterCache.test.ts` | 新建：下载/断点/失败降级测试 |
| `src/pages/SourceBookPage.tsx` | 缓存按钮 + 进度 |
| `src/pages/ReaderPage.tsx` | loadChapter 优先读缓存 |
| 各测试文件 | 适配 |

## 6. 测试

- Rust：save/list/get/delete roundtrip、UPSERT、跨书隔离、delete_book_cache。
- chapterCache（前端）：整本下载成功（mock httpGet + saveCachedChapter）、已缓存章节跳过（断点续传）、单章失败降级继续、取消。
- SourceBookPage：缓存按钮状态/进度回调。
- ReaderPage：缓存命中直接用缓存（httpGet 不被调用）、未命中走在线。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 7. 错误处理

- 单章抓取失败 → failed+1 继续，结束后提示。
- 全书下载中组件卸载 → 取消标记，停止后续保存。
- 缓存读取失败 → 走在线抓取（缓存只是加速层，不阻塞阅读）。
- 缓存写入失败 → 单章跳过（不中断），下载结束汇总。
