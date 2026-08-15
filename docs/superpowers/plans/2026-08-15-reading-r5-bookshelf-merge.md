# 阅读体验 R5：书架融合（书源书进书架） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 书源书（在线书）可加入书架；书架页统一展示本地书 + 在线书；在线书点击直接进入阅读页（续读进度）；「加入书架」入口在书籍详情页与阅读页提供。

**Architecture:** Rust 新增 `shelf_source_books` 表与三个命令（add/list/remove，save_source_progress 联动 last_opened_at）；前端 api.ts 封装；LibraryPage 合并渲染；SourceBookPage/ReaderPage 加入书架按钮。

**Tech Stack:** Rust（rusqlite）+ React 19 + TypeScript + vitest。无新依赖。

## Global Constraints

- 不动本地书（books 表）逻辑；在线书标注/书签不做。
- 不做书架分组/排序/视图切换、章节缓存、封面本地缓存。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；Rust 测试 `cargo test -p yd_lib`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src-tauri/src/db.rs` | shelf_source_books 表 + add/list/remove + save_source_progress 联动 | 修改 |
| `src-tauri/src/commands.rs` | 三个命令 | 修改 |
| `src-tauri/tests/db_test.rs` | 表/函数测试 | 修改 |
| `src/services/api.ts` | ShelfSourceBook + 封装 | 修改 |
| `src/components/BookCard.tsx` | source 类型渲染 | 修改 |
| `src/components/BookCard.test.tsx` | source 渲染测试 | 修改 |
| `src/pages/LibraryPage.tsx` | 合并书架 + onOpenSourceBook | 修改 |
| `src/pages/LibraryPage.test.tsx` | 混合渲染测试 | 修改 |
| `src/App.tsx` | sourceReader 路由回调 | 修改 |
| `src/pages/SourceBookPage.tsx` | 加入书架按钮 | 修改 |
| `src/pages/ReaderPage.tsx` | 加入书架按钮 | 修改 |

## 任务依赖

Task 1（Rust 后端）→ Task 2（api.ts + BookCard）→ Task 3（LibraryPage + App 路由）→ Task 4（加入书架按钮）→ Task 5（全量验证）。

---

### Task 1: Rust 后端

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/db_test.rs`

- [ ] **Step 1: db.rs 表 + 结构**

init_db 追加：

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

结构体：

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShelfSourceBook {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub book_url: String,
    pub title: String,
    pub author: Option<String>,
    pub cover_url: Option<String>,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewShelfSourceBook {
    pub source_id: i64,
    pub book_url: String,
    pub title: String,
    pub author: Option<String>,
    pub cover_url: Option<String>,
}
```

函数：

```rust
pub fn add_shelf_source_book(conn: &Connection, b: &NewShelfSourceBook) -> Result<i64> {
    let t = now();
    conn.execute(
        "INSERT INTO shelf_source_books (source_id, book_url, title, author, cover_url, added_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
         ON CONFLICT(source_id, book_url) DO UPDATE SET title = excluded.title, author = excluded.author, cover_url = excluded.cover_url",
        params![b.source_id, b.book_url, b.title, b.author, b.cover_url, t],
    )?;
    let id = conn.query_row(
        "SELECT id FROM shelf_source_books WHERE source_id = ?1 AND book_url = ?2",
        params![b.source_id, b.book_url],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn list_shelf_source_books(conn: &Connection) -> Result<Vec<ShelfSourceBook>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.source_id, bs.name, s.book_url, s.title, s.author, s.cover_url, s.added_at, s.last_opened_at
         FROM shelf_source_books s JOIN book_sources bs ON bs.id = s.source_id
         ORDER BY COALESCE(s.last_opened_at, s.added_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ShelfSourceBook {
            id: r.get(0)?, source_id: r.get(1)?, source_name: r.get(2)?,
            book_url: r.get(3)?, title: r.get(4)?, author: r.get(5)?,
            cover_url: r.get(6)?, added_at: r.get(7)?, last_opened_at: r.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn remove_shelf_source_book(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM shelf_source_books WHERE id = ?1", [id])?;
    Ok(())
}
```

`save_source_progress` 追加联动（书在架时更新打开时间）：

```rust
conn.execute(
    "UPDATE shelf_source_books SET last_opened_at = ?1 WHERE source_id = ?2 AND book_url = ?3",
    params![now, p.source_id, p.book_url],
)?;
```

- [ ] **Step 2: commands.rs 三个命令**

```rust
#[derive(serde::Serialize)]
pub struct ShelfSourceBook { /* 与 db 一致，或直接复用 db::ShelfSourceBook */ }

#[tauri::command]
pub fn add_shelf_source_book(
    source_id: i64, book_url: String, title: String,
    author: Option<String>, cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    crate::db::add_shelf_source_book(&state.db.lock().unwrap(), &crate::db::NewShelfSourceBook {
        source_id, book_url, title, author, cover_url,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_shelf_source_books(state: State<'_, AppState>) -> Result<Vec<crate::db::ShelfSourceBook>, String> {
    crate::db::list_shelf_source_books(&state.db.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_shelf_source_book(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    crate::db::remove_shelf_source_book(&state.db.lock().unwrap(), id).map_err(|e| e.to_string())
}
```

（db::ShelfSourceBook 已 derive Serialize，命令直接返回。）

- [ ] **Step 3: db_test.rs 测试**

```rust
#[test]
fn shelf_source_book_crud_and_cascade() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "示例", "https://ex.com", "{}").unwrap();
    let id1 = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), author: Some("刘慈欣".into()), cover_url: None,
    }).unwrap();
    // upsert 幂等：同 key 再次加入返回同一 id 且只保留一条
    let id2 = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体（新版）".into(), author: Some("刘慈欣".into()), cover_url: None,
    }).unwrap();
    assert_eq!(id1, id2);
    let list = list_shelf_source_books(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "三体（新版）");
    assert_eq!(list[0].source_name, "示例");
    // save_source_progress 联动 last_opened_at
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), chapter_index: 2, chapter_url: "https://ex.com/c/2.html".into(),
        chapter_name: "第二章".into(), percent: 0.5,
    }).unwrap();
    let list2 = list_shelf_source_books(&conn).unwrap();
    assert!(list2[0].last_opened_at.is_some());
    // 删除书源级联删除书架条目
    delete_source(&conn, sid).unwrap();
    assert!(list_shelf_source_books(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn shelf_source_book_remove() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "示例", "https://ex.com", "{}").unwrap();
    let id = add_shelf_source_book(&conn, &NewShelfSourceBook {
        source_id: sid, book_url: "https://ex.com/b/1.html".into(),
        title: "三体".into(), author: None, cover_url: None,
    }).unwrap();
    remove_shelf_source_book(&conn, id).unwrap();
    assert!(list_shelf_source_books(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test -p yd_lib --test db_test`
Expected: 全绿（含新增 2）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/tests/db_test.rs
git commit -m "feat: 书架融合后端（shelf_source_books 表与命令）"
```

---

### Task 2: api.ts + BookCard

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/components/BookCard.tsx`
- Test: `src/components/BookCard.test.tsx`

- [ ] **Step 1: api.ts 追加**

```ts
export interface ShelfSourceBook {
  id: number; source_id: number; source_name: string; book_url: string;
  title: string; author: string | null; cover_url: string | null;
  added_at: number; last_opened_at: number | null;
}

export async function addShelfSourceBook(a: { sourceId: number; bookUrl: string; title: string; author?: string; coverUrl?: string }): Promise<number> {
  return invoke<number>("add_shelf_source_book", {
    sourceId: a.sourceId, bookUrl: a.bookUrl, title: a.title,
    author: a.author ?? null, coverUrl: a.coverUrl ?? null,
  });
}
export async function listShelfSourceBooks(): Promise<ShelfSourceBook[]> {
  return invoke<ShelfSourceBook[]>("list_shelf_source_books");
}
export async function removeShelfSourceBook(id: number): Promise<void> {
  await invoke("remove_shelf_source_book", { id });
}
```

- [ ] **Step 2: BookCard 支持 source 类型**

统一条目类型（导出）：

```ts
export type ShelfItem =
  | { kind: "local"; book: Book }
  | { kind: "source"; sb: ShelfSourceBook };
```

BookCard props 改为接收 `item: ShelfItem`（或保持 `book` prop 兼容 + 新增 `sourceItem`？**选统一重构**：BookCard 接收 `item: ShelfItem`，`onOpen: (item: ShelfItem) => void`，`onRemove?: (item: ShelfItem) => void`）：

```tsx
export default function BookCard({ item, onOpen, onRemove }: {
  item: ShelfItem; onOpen: (item: ShelfItem) => void; onRemove?: (item: ShelfItem) => void;
}) {
  const title = item.kind === "local" ? item.book.title : item.sb.title;
  const subLabel = item.kind === "local" ? formatLabel(item.book.format) : item.sb.source_name;
  const cover = item.kind === "local"
    ? (item.book.cover_path ? <img className="book-cover" src={coverUrl(item.book.cover_path)} alt={title} /> : <div className={`book-cover book-cover-placeholder ${placeholderClass(item.book.format)}`}><span>{formatLabel(item.book.format)}</span><span className="ph-rule" /></div>)
    : (item.sb.cover_url ? <img className="book-cover" src={item.sb.cover_url} alt={title} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : <div className="book-cover book-cover-placeholder ph-other"><span>在线</span><span className="ph-rule" /></div>);
  return (
    <div className="book-card" onClick={() => onOpen(item)} onKeyDown={handleKey} role="button" tabIndex={0} aria-label={`打开 ${title}`}>
      {cover}
      <div className="book-meta">
        <h3>{title}</h3>
        <div className="book-sub"><span className="fmt">{subLabel}</span></div>
      </div>
      {onRemove && <button className="book-remove" onClick={(e) => { e.stopPropagation(); onRemove(item); }} aria-label={`删除 ${title}`}>×</button>}
    </div>
  );
}
```

- [ ] **Step 3: BookCard.test.tsx 追加 source 用例**

```tsx
it("renders a source shelf item with source name badge", () => {
  render(<BookCard item={{ kind: "source", sb: { id: 1, source_id: 2, source_name: "示例", book_url: "https://ex.com/b/1.html", title: "三体", author: "刘慈欣", cover_url: null, added_at: 1, last_opened_at: null } }} onOpen={() => {}} />);
  expect(screen.getByText("三体")).toBeInTheDocument();
  expect(screen.getByText("示例")).toBeInTheDocument();
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/BookCard.test.tsx`
Expected: 全绿（含新增）

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/components/BookCard.tsx src/components/BookCard.test.tsx
git commit -m "feat: 书架条目类型与 BookCard 支持在线书"
```

---

### Task 3: LibraryPage 合并书架 + App 路由

**Files:**
- Modify: `src/pages/LibraryPage.tsx`
- Modify: `src/pages/LibraryPage.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: LibraryPage 合并渲染**

- state：`items: ShelfItem[]`（`listBooks()` → local；`listShelfSourceBooks()` → source）。
- props：`onOpenBook: (b: Book) => void` 保留 + 新增 `onOpenSourceBook: (sb: ShelfSourceBook) => void`。
- 移除：`onRemove={(item) => item.kind === "local" ? removeBook(item.book.id) : removeShelfSourceBook(item.sb.id)}`。
- 搜索跳转逻辑保持（仅本地书）。
- 空态文案更新：「书架空空如也」→ 提示可导入本地书或从发现添加在线书。

- [ ] **Step 2: App.tsx 路由**

- LibraryPage 调用处加 `onOpenSourceBook={(sb) => setState({ area: "detail", page: "sourceReader", sourceId: sb.source_id, bookUrl: sb.book_url, bookTitle: sb.title, chapterIndex: -1, chapterUrl: "", chapterName: "", back: "bookshelf" })}`。

- [ ] **Step 3: LibraryPage.test.tsx 追加用例**

```tsx
it("renders local and source books together", async () => {
  vi.mocked(api.listBooks).mockResolvedValue([localBook]);
  vi.mocked(api.listShelfSourceBooks).mockResolvedValue([{ id: 1, source_id: 2, source_name: "示例", book_url: "https://ex.com/b/1.html", title: "三体", author: "刘慈欣", cover_url: null, added_at: 1, last_opened_at: null }]);
  render(<LibraryPage onOpenBook={() => {}} onOpenSourceBook={onOpenSourceBook} />);
  expect(await screen.findByText("本地书标题")).toBeInTheDocument();
  expect(screen.getByText("三体")).toBeInTheDocument();
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/LibraryPage.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/pages/LibraryPage.tsx src/pages/LibraryPage.test.tsx src/App.tsx
git commit -m "feat: 书架统一展示本地书与在线书"
```

---

### Task 4: 加入书架按钮（SourceBookPage / ReaderPage）

**Files:**
- Modify: `src/pages/SourceBookPage.tsx`
- Modify: `src/pages/ReaderPage.tsx`
- Test: `src/pages/SourceBookPage.test.tsx`、`src/pages/ReaderPage.source.test.tsx`

- [ ] **Step 1: 共享加入/判断逻辑（services/api 或新 hook）**

轻量做法：组件内 `onShelf` state + `useEffect` 查 `listShelfSourceBooks()` 判断。

```tsx
const [onShelf, setOnShelf] = useState(false);
const [shelfBusy, setShelfBusy] = useState(false);
useEffect(() => {
  let cancelled = false;
  void listShelfSourceBooks().then((l) => {
    if (!cancelled) setOnShelf(l.some((s) => s.source_id === sourceId && s.book_url === bookUrl));
  }).catch(() => {});
  return () => { cancelled = true; };
}, [sourceId, bookUrl]);

const toggleShelf = async () => {
  if (shelfBusy) return;
  setShelfBusy(true);
  try {
    if (onShelf) {
      const l = await listShelfSourceBooks();
      const hit = l.find((s) => s.source_id === sourceId && s.book_url === bookUrl);
      if (hit) await removeShelfSourceBook(hit.id);
      setOnShelf(false);
    } else {
      await addShelfSourceBook({ sourceId, bookUrl, title: info.title, author: info.author, coverUrl: info.coverUrl });
      setOnShelf(true);
    }
  } catch (e) {
    showError(String(e));
  } finally {
    setShelfBusy(false);
  }
};
```

（SourceBookPage 与 ReaderPage 各有一份——先不抽 hook，两处代码量小，保持一致即可。若重复明显再抽 `useShelfToggle`。）

- [ ] **Step 2: SourceBookPage 按钮（书籍信息区）**

```tsx
<button className="btn btn-ghost" onClick={toggleShelf} disabled={shelfBusy}>
  {onShelf ? "已在书架" : "加入书架"}
</button>
```

放在「开始阅读」旁（meta 内加一个 action 行）。

- [ ] **Step 3: ReaderPage 按钮（顶栏书源分支）**

```tsx
<button className="btn btn-ghost" onClick={toggleShelf} disabled={shelfBusy}>
  {onShelf ? "已在书架" : "加入书架"}
</button>
```

放在「登录」旁（或目录/设置前）。注意 ReaderPage 的 `bookUrl` 是 prop（sourceReader 路径有值）。

- [ ] **Step 4: 测试**

- SourceBookPage.test.tsx：mock `listShelfSourceBooks/addShelfSourceBook/removeShelfSourceBook`，断言按钮状态切换与调用。
- ReaderPage.source.test.tsx：同上。
- 现有 api mock 需补新函数（`listShelfSourceBooks: vi.fn().mockResolvedValue([])` 等）。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx src/pages/ReaderPage.source.test.tsx`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/pages/SourceBookPage.tsx src/pages/ReaderPage.tsx src/pages/SourceBookPage.test.tsx src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 书籍详情与阅读页加入书架"
```

---

### Task 5: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 2: Rust 全量测试**

Run: `cargo test -p yd_lib`
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 终审清单**

- [ ] Rust：表/三命令/联动/级联 + 2 测试 ✓
- [ ] api.ts 封装 ✓
- [ ] BookCard source 渲染 + 测试 ✓
- [ ] LibraryPage 合并 + App 路由 + 测试 ✓
- [ ] SourceBookPage/ReaderPage 加入书架按钮 + 测试 ✓
- [ ] `npm test`、`cargo test`、`npm run build` 全绿、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 书架融合终审修复`）。

- [ ] **Step 5: Commit（若终审有修复）**

```bash
git commit -am "fix: 书架融合终审修复"
```

---
