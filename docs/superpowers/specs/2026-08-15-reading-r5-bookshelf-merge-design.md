# 复刻 legado 阅读体验 R5：书架融合（书源书进书架）

日期：2026-08-15
状态：待批准
前置：R1-R4 完成。

## 1. 目标

书源书（在线书）可加入书架，书架页（LibraryPage）统一展示本地书 + 在线书，点击在线书直接进入阅读页（续读进度）；「加入书架」入口在书籍详情页（SourceBookPage）与阅读页（ReaderPage）提供。

## 2. 背景与问题

当前书架（LibraryPage）只列本地书（`books` 表）；书源书读完即失联，入口仅停留在 Discover/Explore 的搜索结果，进度存在 `book_source_progress` 表但无统一入口。legado 的体验是书架统一管理本地 + 在线书。

## 3. 非目标

- 不做书架分组/排序/视图切换（后续迭代）。
- 不做章节缓存/离线下载（换源与缓存属后续迭代）。
- 不做在线书的标注/书签（本地书专属）。
- 不做封面本地缓存（在线封面直链展示，失败用占位）。

## 4. 架构

```
shelf_source_books 表（新，Rust db.rs）
  id, source_id REFERENCES book_sources(id) ON DELETE CASCADE,
  book_url, title, author, cover_url, added_at, last_opened_at
  UNIQUE(source_id, book_url)

后端命令（commands.rs）：
  add_shelf_source_book(sourceId, bookUrl, title, author, coverUrl) → id（upsert）
  list_shelf_source_books() → Vec<ShelfSourceBook>（join book_sources 取 sourceName）
  remove_shelf_source_book(id)
  save_source_progress 时同步 UPDATE shelf 的 last_opened_at

前端：
  api.ts：ShelfSourceBook 类型 + 三个命令封装
  LibraryPage：书架条目 = 本地书 ∪ 在线书，统一渲染 BookCard（在线书用封面 URL/占位）
  SourceBookPage：书籍信息区「加入书架」按钮（已在书架则显示「已在书架」，可移除）
  ReaderPage：顶栏（书源路径）「加入书架」按钮（复用同一逻辑）
  onOpenBook 扩展：支持打开在线书 → sourceReader
```

### 4.1 数据库（db.rs）

```sql
CREATE TABLE IF NOT EXISTS shelf_source_books (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
    book_url TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    cover_url TEXT,
    added_at INTEGER NOT NULL,
    last_opened_at INTEGER,
    UNIQUE(source_id, book_url)
);
```

- `add_shelf_source_book`：`INSERT ... ON CONFLICT(source_id, book_url) DO UPDATE SET title=excluded.title, author=excluded.author, cover_url=excluded.cover_url`；返回 id。
- `list_shelf_source_books`：`SELECT s.*, bs.name AS source_name FROM shelf_source_books s JOIN book_sources bs ON bs.id = s.source_id ORDER BY COALESCE(s.last_opened_at, s.added_at) DESC`。
- `delete_source`（删书源）已级联删除（外键 ON DELETE CASCADE；PRAGMA foreign_keys = ON 已启用）。
- `save_source_progress` 追加：`UPDATE shelf_source_books SET last_opened_at = ?now WHERE source_id=? AND book_url=?`（书在架时才更新，无则忽略）。

### 4.2 后端命令（commands.rs）

```rust
#[derive(serde::Serialize)] pub struct ShelfSourceBook {
    pub id: i64, pub source_id: i64, pub source_name: String, pub book_url: String,
    pub title: String, pub author: Option<String>, pub cover_url: Option<String>,
    pub added_at: i64, pub last_opened_at: Option<i64>,
}

#[tauri::command] add_shelf_source_book(source_id, book_url, title, author: Option<String>, cover_url: Option<String>) -> Result<i64, String>
#[tauri::command] list_shelf_source_books() -> Result<Vec<ShelfSourceBook>, String>
#[tauri::command] remove_shelf_source_book(id) -> Result<(), String>
```

### 4.3 前端 api.ts

```ts
export interface ShelfSourceBook {
  id: number; source_id: number; source_name: string; book_url: string;
  title: string; author: string | null; cover_url: string | null;
  added_at: number; last_opened_at: number | null;
}
export async function addShelfSourceBook(a: { sourceId: number; bookUrl: string; title: string; author?: string; coverUrl?: string }): Promise<number>;
export async function listShelfSourceBooks(): Promise<ShelfSourceBook[]>;
export async function removeShelfSourceBook(id: number): Promise<void>;
```

### 4.4 书架统一展示（LibraryPage + BookCard）

- `ShelfItem = { kind: "local"; book: Book } | { kind: "source"; sb: ShelfSourceBook }`。
- LibraryPage 并行加载 `listBooks()` + `listShelfSourceBooks()`，合并渲染。
- BookCard 适配：source 类型显示封面（cover_url 或占位）、标题、来源名徽标；移除操作区分 `removeBook` / `removeShelfSourceBook`。
- 点击 source 条目 → `onOpenSourceBook(sb)` → App 进入 `sourceReader`（chapterIndex: -1 走进度续读）。
- App.tsx：LibraryPage 的 onOpenSourceBook 回调 → `setState({ area: "detail", page: "sourceReader", ..., chapterIndex: -1, chapterUrl: "", chapterName: "" })`。

### 4.5 加入书架按钮（SourceBookPage / ReaderPage）

- SourceBookPage：fetchToc 已返回 info（title/author/coverUrl）；「加入书架」按钮在书籍信息区（meta 内，开始阅读旁）。状态：未加入 →「加入书架」；已加入 →「已在书架」（点击移除，或仅展示）。
- ReaderPage（书源路径）：顶栏按钮（目录/设置旁），复用相同逻辑；点击后提示「已加入书架」。
- 判断是否已在书架：`listShelfSourceBooks()` 查询匹配 `source_id + book_url`（轻量，缓存到 state；书架数据量小，直接查）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/db.rs` | shelf_source_books 表 + 三个函数 + save_source_progress 联动 |
| `src-tauri/src/commands.rs` | 三个命令 |
| `src-tauri/tests/db_test.rs` | 表/函数测试 |
| `src/services/api.ts` | ShelfSourceBook + 三个封装 |
| `src/components/BookCard.tsx` | 支持 source 类型渲染 |
| `src/pages/LibraryPage.tsx` | 合并书架 + onOpenSourceBook |
| `src/pages/App.tsx` | sourceReader 路由回调 |
| `src/pages/SourceBookPage.tsx` | 加入书架按钮 |
| `src/pages/ReaderPage.tsx` | 加入书架按钮 |
| 各测试文件 | 对应单测 |

## 6. 测试

- Rust：add/list/remove roundtrip、upsert 幂等、删书源级联、save_source_progress 更新 last_opened_at。
- 前端：LibraryPage 混合渲染、打开在线书回调、SourceBookPage/ReaderPage 加入/已在书架状态切换、BookCard source 渲染。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 7. 错误处理

- 加入失败（书源被删）→ showError。
- 封面加载失败 → 占位（现有 onError 逻辑）。
- 书架数据加载失败 → 只显示本地书 + showError（不阻塞）。
