# 复刻 legado 阅读体验 R11：RSS 订阅

日期：2026-08-15
状态：待批准
前置：R1-R10 完成。

## 1. 目标

实现 RSS 订阅：订阅源管理（添加/删除/刷新）、文章列表、文章阅读（RSS 内文 + 网页原文提取）。替换当前 RssPage 占位页。

## 2. 背景与问题

legado 支持订阅源（RSS/Atom）聚合阅读。当前 RssPage 是「敬请期待」占位；网络层已有 Rust reqwest（http_get），可复用。

## 3. 非目标

- 不做 OPML 导入/导出、订阅源分组（后续迭代）。
- 不做文章已读/收藏/离线缓存（本批仅订阅与阅读；已读状态后续）。
- 不做规则书源（legado 的 rssSource 规则引擎）——本批用标准 RSS/Atom 解析。

## 4. 架构

```
Rust 后端：
  rss_feeds 表（新）：id, title, url, site_url, added_at
  rss_articles 表（新）：id, feed_id, guid(唯一), title, link, content, published_at, fetched_at
  fetch_rss_feed(url) 命令：http_get → 解析 RSS/Atom → 返回 { feed, articles }（不落库，前端预览）
  refresh_rss_feed(feedId) 命令：抓取并 UPSERT 文章到 rss_articles
  list_rss_feeds() / add_rss_feed(url) / delete_rss_feed(id)
  list_rss_articles(feedId) / get_rss_article(id)

前端：
  RssPage：订阅源列表（左）+ 文章列表（右），添加/删除/刷新
  RssArticlePage：文章阅读（复用 .md-reader 排版；正文取 content 或 link 网页原文）
  RSS 解析：Rust 侧（feed-rs crate）或手写 XML 解析？
```

### 4.1 RSS 解析方案决策

**方案 A：Rust + feed-rs crate**（标准、健壮，支持 RSS 0.9x/2.0/Atom/JSON Feed）。
- 加依赖 `feed-rs = "2"`。
- `fetch_rss_feed`：reqwest 拿 XML → feed-rs parse → 映射结构返回前端。
- 优点：解析健壮，无需前端 XML 处理。
- 缺点：新增 crate 依赖。

**方案 B：前端手写 XML 解析**（DOMParser 解析 RSS 2.0 + Atom 子集）。
- 复用现有前端 httpGet（Rust 网络层）。
- 优点：无新依赖；缺点：解析覆盖面小，RSS 变体多。

**选 A**（Rust feed-rs）：解析是订阅器的核心，标准 crate 最稳；网络已在 Rust 侧，避免前端 CORS/协议问题。

### 4.2 数据库（db.rs）

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

### 4.3 后端命令

```rust
#[derive(serde::Serialize)] pub struct RssFeedPreview { title, site_url, articles: Vec<RssArticlePreview> }
#[derive(serde::Serialize)] pub struct RssArticlePreview { guid, title, link, content, published_at }

#[tauri::command] fetch_rss_feed(url) -> Result<RssFeedPreview, String>   // 抓取+解析，不落库
#[tauri::command] add_rss_feed(url) -> Result<i64, String>                // 抓取→建 feed→落文章
#[tauri::command] refresh_rss_feed(feed_id) -> Result<usize, String>       // 重抓，UPSERT 新文章，返回新增数
#[tauri::command] list_rss_feeds() -> Result<Vec<RssFeedRow>, String>
#[tauri::command] delete_rss_feed(id) -> Result<(), String>
#[tauri::command] list_rss_articles(feed_id) -> Result<Vec<RssArticleRow>, String>
#[tauri::command] get_rss_article(id) -> Result<Option<RssArticleRow>, String>
```

- `add_rss_feed`：fetch_rss_feed → INSERT feed（title/site_url）→ 批量 INSERT 文章 → 返回 feed id。
- `refresh_rss_feed`：fetch → UPSERT articles（ON CONFLICT(feed_id, guid) DO UPDATE content/published_at）→ 返回新增条数（可用 changes() 或比较）。
- 网络用现有 `crate::net::http_get`（带 UA/超时）。

### 4.4 前端

- **api.ts**：7 个命令封装。
- **RssPage**（重写）：
  - 左栏：订阅源列表（标题 + 文章数 + 刷新/删除按钮）+ 添加输入（URL + 添加按钮）。
  - 右栏：选中源的文章列表（标题 + 发布时间），点击 → RssArticlePage。
  - 添加流程：fetch_rss_feed 预览 → 确认标题 → add_rss_feed。简化：直接 add_rss_feed（失败 showError）。
- **RssArticlePage**：`.md-reader` 排版渲染 content（DOMPurify 净化）；内容为空时提示（部分源 content 为空，后续可做网页原文提取——本批显示 content 或"无正文"）。

### 4.5 路由（App.tsx）

- `rss` 区域：RssPage（含订阅源管理 + 文章列表同屏，或列表点击进入详情）。
- 新增 detail 状态 `rssArticle`（articleId + back: "rss"）→ RssArticlePage。
- 简化：RssPage 内做两栏布局（列表+阅读预览）不另开页面？**选独立页**（阅读体验更好，复用阅读排版）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/Cargo.toml` | + feed-rs 依赖 |
| `src-tauri/src/rss.rs` | 新建：fetch/parse/落库逻辑 |
| `src-tauri/src/db.rs` | rss_feeds/rss_articles 表 + 函数 |
| `src-tauri/src/commands.rs` | 7 个命令 |
| `src-tauri/src/lib.rs` | mod rss + 注册命令 |
| `src-tauri/tests/rss_test.rs` | 新建：RSS 解析/落库测试 |
| `src/services/api.ts` | 7 个封装 |
| `src/pages/RssPage.tsx` | 重写：订阅管理 + 文章列表 |
| `src/pages/RssArticlePage.tsx` | 新建：文章阅读 |
| `src/App.tsx` | rssArticle 路由 |
| 各测试文件 | 适配 |

## 6. 测试

- Rust：RSS 2.0/Atom 解析（内嵌样例 XML）、add/refresh UPSERT、级联删除、list/get。
- 前端：RssPage 订阅列表/添加/删除/文章列表；RssArticlePage 渲染净化正文。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 7. 错误处理

- 抓取失败（网络/非 XML）→ showError，不落库。
- 重复添加同 URL → 报错（UNIQUE 冲突提示"已订阅"）。
- 文章 content 为空 → 显示"无正文内容"。
- 刷新失败 → 保留旧数据，showError。
