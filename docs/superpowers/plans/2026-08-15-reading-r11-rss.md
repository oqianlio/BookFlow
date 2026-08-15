# 阅读体验 R11：RSS 订阅 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 RSS 订阅：订阅源管理（添加/删除/刷新）、文章列表、文章阅读。替换 RssPage 占位页。

**Architecture:** Rust `rss.rs`（手写 RSS 2.0/Atom 轻量解析器，零新依赖）+ `rss_feeds`/`rss_articles` 表 + 7 个命令；前端 RssPage 重写（订阅管理 + 文章列表）+ RssArticlePage（文章阅读）。

**Tech Stack:** Rust（rusqlite + reqwest 现有）+ React 19 + TypeScript + vitest。**无新依赖**（手写 XML 解析）。

## Global Constraints

- 零新依赖（Rust 手写解析，不引 feed-rs）。
- 标准 RSS 2.0 / Atom 子集；不做 OPML、分组、已读/收藏、离线缓存。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；Rust 测试 `cargo test`（src-tauri 目录）；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src-tauri/src/rss.rs` | 手写解析 + 落库逻辑 | 新建 |
| `src-tauri/src/db.rs` | rss_feeds/rss_articles 表 + 函数 | 修改 |
| `src-tauri/src/commands.rs` | 7 个命令 | 修改 |
| `src-tauri/src/lib.rs` | mod rss + 注册 | 修改 |
| `src-tauri/tests/rss_test.rs` | 解析/落库测试 | 新建 |
| `src/services/api.ts` | 7 个封装 | 修改 |
| `src/pages/RssPage.tsx` | 重写 | 修改 |
| `src/pages/RssArticlePage.tsx` | 新建 | 新建 |
| `src/App.tsx` | rssArticle 路由 | 修改 |
| `src/pages/RssPage.test.tsx` | 新建 | 新建 |

## 任务依赖

Task 1（Rust 解析 + 落库）→ Task 2（命令 + db 表）→ Task 3（前端 api + RssPage）→ Task 4（RssArticlePage + 路由）→ Task 5（验证）。

---

### Task 1: rss.rs 手写解析器 + db 表

**Files:**
- Create: `src-tauri/src/rss.rs`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/tests/rss_test.rs`

**Interfaces:**
- Produces:
  ```rust
  pub struct RssArticlePreview { pub guid: String, pub title: String, pub link: Option<String>, pub content: Option<String>, pub published_at: Option<i64> }
  pub struct RssFeedPreview { pub title: String, pub site_url: Option<String>, pub articles: Vec<RssArticlePreview> }
  pub fn parse_rss_xml(xml: &str) -> Result<RssFeedPreview, String>;
  pub fn fetch_feed_preview(url: &str) -> Result<RssFeedPreview, String>;  // 调 net::http_get
  ```

- [ ] **Step 1: 写失败测试（rss_test.rs）**

```rust
use yd_lib::rss::parse_rss_xml;

const RSS2: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>测试频道</title><link>https://ex.com</link>
  <item><title>文章一</title><link>https://ex.com/a1</link><guid>g1</guid><description><![CDATA[<p>正文一</p>]]></description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  <item><title>文章二</title><link>https://ex.com/a2</link><guid>g2</guid><description>纯文本二</description></item>
</channel></rss>"#;

const ATOM: &str = r#"<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 频道</title>
  <entry><title>条目一</title><id>tag:ex,2024:1</id><link href="https://ex.com/e1"/><content type="html"><p>内容一</p></content><updated>2024-01-01T00:00:00Z</updated></entry>
</feed>"#;

#[test]
fn parses_rss20_feed() {
    let f = parse_rss_xml(RSS2).unwrap();
    assert_eq!(f.title, "测试频道");
    assert_eq!(f.site_url.as_deref(), Some("https://ex.com"));
    assert_eq!(f.articles.len(), 2);
    assert_eq!(f.articles[0].title, "文章一");
    assert_eq!(f.articles[0].guid, "g1");
    assert!(f.articles[0].content.as_deref().unwrap().contains("正文一"));
    assert_eq!(f.articles[1].title, "文章二");
}

#[test]
fn parses_atom_feed() {
    let f = parse_rss_xml(ATOM).unwrap();
    assert_eq!(f.title, "Atom 频道");
    assert_eq!(f.articles.len(), 1);
    assert_eq!(f.articles[0].title, "条目一");
    assert_eq!(f.articles[0].guid, "tag:ex,2024:1");
    assert!(f.articles[0].content.as_deref().unwrap().contains("内容一"));
}

#[test]
fn rejects_non_xml() {
    assert!(parse_rss_xml("not xml at all").is_err());
}
```

- [ ] **Step 2: 运行确认失败**

Run（src-tauri）: `cargo test --test rss_test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 rss.rs 解析器**

手写轻量 XML 解析（不引外部 XML crate）：
- 提取 `<channel>` 内 `<title>`/`<link>`（RSS）或 `<feed>` 内 `<title>`（Atom）。
- 提取 items/entries：正则 `<item>[\s\S]*?</item>` / `<entry>[\s\S]*?</entry>`。
- 每项提取 title/link/guid/id/description/content/pubDate/updated。
- 提取函数：`extract_tag(block, "title")` 取首个标签文本；去 CDATA、HTML 实体基本解码（&lt; &gt; &amp; &quot; &apos;）。
- 时间解析：RSS pubDate RFC822 → 尝试简单解析；Atom ISO8601；失败 None。

```rust
fn extract_tag(block: &str, tag: &str) -> Option<String> {
    // <tag ...>...</tag> 或 <tag>...</tag>，大小写不敏感，支持 CDATA
    let re = Regex::new(&format!(r"(?is)<{}[^>]*>(.*?)</{}>", tag, tag)).ok()?;
    let caps = re.captures(block)?;
    Some(clean_text(caps.get(1)?.as_str()))
}
```

**注意**：需要 regex crate？项目未依赖 regex。检查 Cargo.toml——无 regex。**手写字符串扫描**替代：用 `find`/`split` 实现 `extract_tag`（找 `<tag` 开标签 → 找 `>` → 找 `</tag>`）。避免加 regex 依赖。

```rust
fn extract_tag(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = block.find(&open)?;
    let open_end = block[start..].find('>')? + start + 1;
    let end = block[open_end..].find(&close)? + open_end;
    Some(clean_text(&block[open_end..end]))
}
```

（大小写不敏感：解析前把 XML 统一小写标签？**不**——内容不能小写。用不区分大小写查找：`to_lowercase` 版 block 用于定位，原 block 取内容。实现 `find_tag` 辅助。）

时间解析：`parse_rfc822` / `parse_iso8601` 手写简化版（提取 4 位年、2 位月日时分秒）→ 时间戳；失败 None。

- [ ] **Step 4: db.rs 表 + 函数**

```sql
CREATE TABLE IF NOT EXISTS rss_feeds (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rss_articles (
    id INTEGER PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    content TEXT,
    published_at INTEGER,
    fetched_at INTEGER NOT NULL,
    UNIQUE(feed_id, guid)
);
```

```rust
#[derive(serde::Serialize)] pub struct RssFeedRow { id, title, url, site_url, added_at }
#[derive(serde::Serialize)] pub struct RssArticleRow { id, feed_id, guid, title, link, content, published_at, fetched_at }
pub fn add_rss_feed_db(conn, title, url, site_url) -> Result<i64>;
pub fn list_rss_feeds_db(conn) -> Result<Vec<RssFeedRow>>;
pub fn delete_rss_feed_db(conn, id) -> Result<()>;
pub fn upsert_rss_article(conn, feed_id, &RssArticlePreview) -> Result<i64>;  // ON CONFLICT(feed_id,guid) DO UPDATE
pub fn list_rss_articles_db(conn, feed_id) -> Result<Vec<RssArticleRow>>;
pub fn get_rss_article_db(conn, id) -> Result<Option<RssArticleRow>>;
```

- [ ] **Step 5: 运行确认通过**

Run（src-tauri）: `cargo test --test rss_test`
Expected: 3 PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rss.rs src-tauri/src/db.rs src-tauri/tests/rss_test.rs
git commit -m "feat: RSS 解析器与数据表"
```

---

### Task 2: 后端命令

**Files:**
- Modify: `src-tauri/src/rss.rs`（fetch_feed_preview）
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: rss.rs 网络与命令辅助**

```rust
pub fn fetch_feed_preview(url: &str) -> Result<RssFeedPreview, String> {
    // 调 crate::net::http_get（async 命令内调用——http_get 是 #[tauri::command] async，不能在普通 fn 直接调。
    // 方案：rss.rs 提供同步 http 请求函数（复用 net::build_request + reqwest blocking），或命令内先 http_get 再 parse。
    // 更简单：命令层拿 XML → parse_rss_xml。fetch_feed_preview 省略，命令里分两步。
}
```

**调整**：命令层流程（commands.rs）：
1. `http_get_xml(url)`：新建 rss.rs 内同步函数，复用 net 的 UA/超时（reqwest blocking 直接发，不经过 cookie jar——RSS 无需 cookie）。

```rust
pub fn http_get_xml(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(crate::net::DEFAULT_TIMEOUT_MS))
        .build().map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let mut headers = std::collections::HashMap::new();
    headers.insert("User-Agent".into(), crate::net::DEFAULT_UA.into());
    let resp = crate::net::build_request(&client, "GET", url, &headers, None, None)
        .send().map_err(|e| format!("网络请求失败: {e}"))?;
    let mut bytes = Vec::new();
    resp.copy_to(&mut bytes).map_err(|e| format!("读取响应失败: {e}"))?;
    crate::net::decode_body(&bytes, None)
}
```

- [ ] **Step 2: commands.rs 7 个命令**

```rust
#[tauri::command]
pub fn fetch_rss_feed(url: String) -> Result<RssFeedPreview, String> {
    let xml = crate::rss::http_get_xml(&url)?;
    crate::rss::parse_rss_xml(&xml)
}

#[tauri::command]
pub fn add_rss_feed(url: String, state: State<'_, AppState>) -> Result<i64, String> {
    let xml = crate::rss::http_get_xml(&url)?;
    let preview = crate::rss::parse_rss_xml(&xml)?;
    let conn = state.db.lock().unwrap();
    let id = crate::db::add_rss_feed_db(&conn, &preview.title, &url, preview.site_url.as_deref())?;
    for a in &preview.articles {
        let _ = crate::db::upsert_rss_article(&conn, id, a);
    }
    Ok(id)
}

#[tauri::command]
pub fn refresh_rss_feed(feed_id: i64, state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock().unwrap();
    let row = crate::db::get_rss_feed_db(&conn, feed_id)?.ok_or("订阅源不存在")?;
    drop(conn);
    let xml = crate::rss::http_get_xml(&row.url)?;
    let preview = crate::rss::parse_rss_xml(&xml)?;
    let conn = state.db.lock().unwrap();
    let mut added = 0;
    for a in &preview.articles {
        added += crate::db::upsert_rss_article(&conn, feed_id, a)?;
    }
    Ok(added)
}

#[tauri::command]
pub fn list_rss_feeds(state: State<'_, AppState>) -> Result<Vec<RssFeedRow>, String> { ... }
#[tauri::command]
pub fn delete_rss_feed(id: i64, state: State<'_, AppState>) -> Result<(), String> { ... }
#[tauri::command]
pub fn list_rss_articles(feed_id: i64, state: State<'_, AppState>) -> Result<Vec<RssArticleRow>, String> { ... }
#[tauri::command]
pub fn get_rss_article(id: i64, state: State<'_, AppState>) -> Result<Option<RssArticleRow>, String> { ... }
```

`upsert_rss_article` 返回新增数：`conn.execute(...)` 的 changes() 在 ON CONFLICT DO UPDATE 时 SQLite 返回 1（更新也算 1 行影响）。**改为**：先 SELECT 是否存在，不存在才 INSERT → 返回 1/0。或用 `ON CONFLICT DO NOTHING` + changes()（插入 1、冲突 0）——但这样不更新已有文章内容。**决策**：UPSERT（更新内容），返回新增数用「INSERT 前 SELECT 判断」：存在则 UPDATE 不计数，不存在则 INSERT 计数 1。

- [ ] **Step 3: lib.rs mod rss + 注册**

- [ ] **Step 4: 运行确认通过**

Run（src-tauri）: `cargo test`
Expected: 全绿（rss_test 3 + 既有）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rss.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: RSS 后端命令（抓取/订阅/刷新/列表）"
```

---

### Task 3: 前端 api + RssPage 重写

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/pages/RssPage.tsx`
- Create: `src/pages/RssPage.test.tsx`

- [ ] **Step 1: api.ts 7 个封装**

```ts
export interface RssFeedPreview { title: string; site_url: string | null; articles: Array<{ guid: string; title: string; link: string | null; content: string | null; published_at: number | null }> }
export interface RssFeedRow { id: number; title: string; url: string; site_url: string | null; added_at: number }
export interface RssArticleRow { id: number; feed_id: number; guid: string; title: string; link: string | null; content: string | null; published_at: number | null; fetched_at: number }

export async function fetchRssFeed(url: string): Promise<RssFeedPreview>;
export async function addRssFeed(url: string): Promise<number>;
export async function refreshRssFeed(feedId: number): Promise<number>;
export async function listRssFeeds(): Promise<RssFeedRow[]>;
export async function deleteRssFeed(id: number): Promise<void>;
export async function listRssArticles(feedId: number): Promise<RssArticleRow[]>;
export async function getRssArticle(id: number): Promise<RssArticleRow | null>;
```

- [ ] **Step 2: RssPage 重写**

两栏布局：
- 左栏「订阅源」：添加（URL input + 按钮）、列表（title + 刷新/删除按钮）。
- 右栏「文章」：选中源后 listRssArticles 展示（标题 + 时间），点击 → `onOpenArticle(article)`。
- 状态：feeds、activeFeedId、articles、busy、error。
- 添加：`addRssFeed(url)` → 刷新列表 → 选中新源。重复 URL 报错提示。
- 删除：confirm → `deleteRssFeed` → 刷新。
- 刷新：`refreshRssFeed(feedId)` → 重新 listRssArticles + 提示新增数。

- [ ] **Step 3: RssPage.test.tsx**

mock api 各函数，断言：添加流程、列表渲染、删除确认、选中显示文章。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/RssPage.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/pages/RssPage.tsx src/pages/RssPage.test.tsx
git commit -m "feat: RSS 订阅管理页"
```

---

### Task 4: RssArticlePage + 路由

**Files:**
- Create: `src/pages/RssArticlePage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: RssArticlePage**

```tsx
export default function RssArticlePage({ articleId, onBack }: { articleId: number; onBack: () => void }) {
  const [article, setArticle] = useState<RssArticleRow | null>(null);
  useEffect(() => { ... getRssArticle(articleId) ... }, [articleId]);
  return (
    <div className="rss-article page">
      <header className="library-header">
        <div className="brand"><h1>{article?.title ?? "文章"}</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      <div className="md-reader">
        <div className="md-content" dangerouslySetInnerHTML={{ __html: sanitize(article?.content ?? "<p>无正文内容</p>") }} />
      </div>
    </div>
  );
}
```

- 净化：DOMPurify（项目已有依赖 dompurify）。
- 时间显示（header 下小字）。

- [ ] **Step 2: App.tsx 路由**

- DetailState 加 `{ area: "detail"; page: "rssArticle"; articleId: number; back: AppArea }`。
- RssPage 加 prop `onOpenArticle={(a) => setState({ area: "detail", page: "rssArticle", articleId: a.id, back: "rss" })}`。
- 渲染分支：RssArticlePage。

- [ ] **Step 3: 测试**

- RssArticlePage.test.tsx：mock getRssArticle → 渲染正文（净化）。
- App.test.tsx 现有用例保持绿（rss 区域仍显示 RssPage——原断言"敬请期待"需更新：RssPage 重写后无该文本。检查 App.test.tsx L28 `await screen.findAllByText(/敬请期待/)` 依赖 RssPage 占位——**需改为断言 RssPage 真实内容**（如"订阅源"标题）。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/RssArticlePage.test.tsx src/App.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/pages/RssArticlePage.tsx src/pages/RssArticlePage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: RSS 文章阅读页"
```

---

### Task 5: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 RssPage/RssArticlePage 用例，App.test 更新）

- [ ] **Step 2: Rust 全量测试**

Run（src-tauri）: `cargo test`
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 终审清单**

- [ ] rss.rs 解析器（RSS2/Atom/拒非 XML）+ 3 测试 ✓
- [ ] db 表 + 6 函数 ✓
- [ ] 7 命令注册 ✓
- [ ] api.ts 7 封装 ✓
- [ ] RssPage 重写（订阅管理 + 文章列表）+ 测试 ✓
- [ ] RssArticlePage + 路由 + App.test 更新 ✓
- [ ] `npm test`、`cargo test`、`npm run build` 全绿、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: RSS 订阅终审修复`）。

- [ ] **Step 5: Commit（若终审有修复）**

```bash
git commit -am "fix: RSS 订阅终审修复"
```

---
