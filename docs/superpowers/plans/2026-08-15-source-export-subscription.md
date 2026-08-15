# 书源生态 R12：导出/复制/分享 + 远程订阅更新 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 书源管理页支持复制/导出/导出全部；新增远程书源订阅（添加订阅 URL、刷新同步新增/更新）。

**Architecture:** Rust `source_subscriptions` 表 + 6 命令（订阅 CRUD、get_source_by_url、write_text_file、set_subscription_checked）；前端 `sourceSubscription.ts` sync 逻辑；BookSourceManager 加操作。

**Tech Stack:** Rust（rusqlite）+ React 19 + TypeScript + vitest。无新依赖。

## Global Constraints

- 不做可视化规则编辑、自动定时刷新、二维码、网页转书源。
- sync 不删除本地书源（removed 保留字段恒 0）。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；Rust 测试 `cargo test`（src-tauri 目录）；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src-tauri/src/db.rs` | source_subscriptions 表 + 4 函数 | 修改 |
| `src-tauri/src/commands.rs` | 6 命令 | 修改 |
| `src-tauri/src/lib.rs` | 注册 | 修改 |
| `src-tauri/tests/db_test.rs` | 订阅表测试 | 修改 |
| `src/services/api.ts` | 封装 | 修改 |
| `src/services/sourceSubscription.ts` | sync 逻辑 | 新建 |
| `src/services/sourceSubscription.test.ts` | sync 测试 | 新建 |
| `src/components/BookSourceManager.tsx` | 复制/导出/订阅分区 | 修改 |
| `src/components/BookSourceManager.test.tsx` | 适配 + 新增 | 修改 |

## 任务依赖

Task 1（Rust 后端）→ Task 2（api + sourceSubscription sync）→ Task 3（BookSourceManager UI）→ Task 4（验证）。

---

### Task 1: Rust 后端

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/db_test.rs`

- [ ] **Step 1: db.rs 表 + 函数**

```sql
CREATE TABLE IF NOT EXISTS source_subscriptions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    last_checked_at INTEGER
);
```

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct SubscriptionRow {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub last_checked_at: Option<i64>,
}

pub fn add_subscription_db(conn, name: &str, url: &str) -> Result<i64> {
    conn.execute("INSERT INTO source_subscriptions (name, url) VALUES (?1, ?2)", params![name, url])?;
    Ok(conn.last_insert_rowid())
}

pub fn list_subscriptions_db(conn) -> Result<Vec<SubscriptionRow>> {
    // SELECT id, name, url, last_checked_at FROM source_subscriptions ORDER BY name
}

pub fn delete_subscription_db(conn, id: i64) -> Result<()> {
    conn.execute("DELETE FROM source_subscriptions WHERE id=?1", [id])?;
    Ok(())
}

pub fn set_subscription_checked_db(conn, id: i64) -> Result<()> {
    conn.execute("UPDATE source_subscriptions SET last_checked_at=?1 WHERE id=?2", params![now(), id])?;
    Ok(())
}

pub fn get_source_by_url_db(conn, url: &str) -> Result<Option<SourceRow>> {
    // SELECT id, name, url, json, enabled, last_used_at FROM book_sources WHERE url=?1
}
```

- [ ] **Step 2: commands.rs 6 命令**

```rust
#[tauri::command]
pub fn add_subscription(url: String, state: State<'_, AppState>) -> Result<i64, String> {
    // 拉取一次获取书源名（用于订阅显示名）：复用 rss::http_get_xml 拿文本，serde_json 提取首个 bookSourceName
    let text = crate::rss::http_get_xml(&url)?;
    let name = crate::rss::extract_first_source_name(&text).unwrap_or_else(|| "订阅源".to_string());
    crate::db::add_subscription_db(&state.db.lock().unwrap(), &name, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_subscriptions(state) -> Result<Vec<SubscriptionRow>, String> { ... }
#[tauri::command]
pub fn delete_subscription(id: i64, state) -> Result<(), String> { ... }
#[tauri::command]
pub fn set_subscription_checked(id: i64, state) -> Result<(), String> { ... }
#[tauri::command]
pub fn get_source_by_url(url: String, state) -> Result<Option<SourceRow>, String> { ... }

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
}
```

rss.rs 加辅助：

```rust
/// 从远程书源合集文本中提取第一个书源的名称（用于订阅显示名）
pub fn extract_first_source_name(text: &str) -> Option<String> {
    let obj: serde_json::Value = serde_json::from_str(text).ok()?;
    let arr = if obj.is_array() { obj.as_array()? } else { std::slice::from_ref(&obj) };
    arr.iter().find_map(|v| {
        v.get("bookSourceName").and_then(|n| n.as_str()).map(|s| s.to_string())
    })
}
```

- [ ] **Step 3: lib.rs 注册 6 命令**

- [ ] **Step 4: db_test.rs 测试**

```rust
#[test]
fn subscription_crud_and_source_lookup() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    // 添加书源 + 订阅
    let sid = add_source(&conn, "源A", "https://a.com", "{\"bookSourceUrl\":\"https://a.com\"}").unwrap();
    let sub_id = add_subscription_db(&conn, "合集A", "https://repo.com/a.json").unwrap();
    let subs = list_subscriptions_db(&conn).unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].name, "合集A");
    set_subscription_checked_db(&conn, sub_id).unwrap();
    assert!(list_subscriptions_db(&conn).unwrap()[0].last_checked_at.is_some());
    // get_source_by_url
    let hit = get_source_by_url_db(&conn, "https://a.com").unwrap().unwrap();
    assert_eq!(hit.id, sid);
    assert!(get_source_by_url_db(&conn, "https://nope.com").unwrap().is_none());
    // 删除订阅
    delete_subscription_db(&conn, sub_id).unwrap();
    assert!(list_subscriptions_db(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 5: 运行确认通过**

Run（src-tauri）: `cargo test --test db_test`
Expected: 全绿（含新增 1）

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/rss.rs src-tauri/tests/db_test.rs
git commit -m "feat: 书源订阅与导出后端"
```

---

### Task 2: api + sourceSubscription sync

**Files:**
- Modify: `src/services/api.ts`
- Create: `src/services/sourceSubscription.ts`
- Test: `src/services/sourceSubscription.test.ts`

- [ ] **Step 1: api.ts 封装**

```ts
export interface SubscriptionRow { id: number; name: string; url: string; last_checked_at: number | null }

export async function addSubscription(url: string): Promise<number> { return invoke("add_subscription", { url }); }
export async function listSubscriptions(): Promise<SubscriptionRow[]> { return invoke("list_subscriptions"); }
export async function deleteSubscription(id: number): Promise<void> { await invoke("delete_subscription", { id }); }
export async function setSubscriptionChecked(id: number): Promise<void> { await invoke("set_subscription_checked", { id }); }
export async function getSourceByUrl(url: string): Promise<BookSource | null> { return invoke("get_source_by_url", { url }); }
export async function writeTextFile(path: string, content: string): Promise<void> { await invoke("write_text_file", { path, content }); }
```

（BookSource 类型已存在：`{ id, name, url, json, enabled, last_used_at }`。）

- [ ] **Step 2: sourceSubscription.ts**

```ts
import { addBookSource, httpGet, listBookSources, updateBookSource } from "./api";
import { parseBookSourceCollection } from "./bookSourceImport";
import type { SubscriptionRow } from "./api";

export interface SyncResult { added: number; updated: number; removed: number; failed: number }

export async function syncSubscription(sub: SubscriptionRow): Promise<SyncResult> {
  const text = await httpGet(sub.url, undefined, 20000);
  const remote = parseBookSourceCollection(text);
  const local = await listBookSources();
  const localByUrl = new Map(local.map((s) => [s.url, s]));
  let added = 0, updated = 0, failed = 0;
  for (const rs of remote) {
    try {
      const existing = localByUrl.get(rs.bookSourceUrl);
      if (existing) {
        const nextJson = JSON.stringify(rs);
        if (existing.json !== nextJson) {
          await updateBookSource(existing.id, rs.bookSourceName, rs.bookSourceUrl, nextJson);
          updated++;
        }
      } else {
        await addBookSource(rs.bookSourceName, rs.bookSourceUrl, JSON.stringify(rs));
        added++;
      }
    } catch {
      failed++;
    }
  }
  return { added, updated, removed: 0, failed };
}
```

- [ ] **Step 3: sourceSubscription.test.ts**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { syncSubscription } from "./sourceSubscription";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  listBookSources: vi.fn(),
  addBookSource: vi.fn().mockResolvedValue(1),
  updateBookSource: vi.fn().mockResolvedValue(undefined),
}));

const remoteJson = JSON.stringify([
  { bookSourceUrl: "https://a.com", bookSourceName: "源A", ruleSearch: {} },
  { bookSourceUrl: "https://b.com", bookSourceName: "源B", ruleSearch: {} },
]);

const sub = { id: 1, name: "合集", url: "https://repo.com/a.json", last_checked_at: null };

beforeEach(() => vi.clearAllMocks());

describe("syncSubscription", () => {
  it("adds new sources and updates changed ones", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(remoteJson);
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 10, name: "源A", url: "https://a.com", json: JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A" }), enabled: true, last_used_at: null },
    ]);
    const r = await syncSubscription(sub);
    expect(r.added).toBe(1);   // 源B 新增
    expect(r.updated).toBe(1); // 源A 更新（json 变化）
    expect(api.addBookSource).toHaveBeenCalledTimes(1);
    expect(api.updateBookSource).toHaveBeenCalledTimes(1);
  });

  it("skips unchanged sources", async () => {
    const sameJson = JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A", ruleSearch: {} });
    vi.mocked(api.httpGet).mockResolvedValue(JSON.stringify([JSON.parse(sameJson)]));
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 10, name: "源A", url: "https://a.com", json: sameJson, enabled: true, last_used_at: null },
    ]);
    const r = await syncSubscription(sub);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
    expect(api.updateBookSource).not.toHaveBeenCalled();
  });

  it("counts failures and continues", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(remoteJson);
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(api.addBookSource).mockRejectedValueOnce(new Error("db 错误")).mockResolvedValueOnce(2);
    const r = await syncSubscription(sub);
    expect(r.failed).toBe(1);
    expect(r.added).toBe(1);
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/sourceSubscription.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api.ts src/services/sourceSubscription.ts src/services/sourceSubscription.test.ts
git commit -m "feat: 书源订阅同步逻辑"
```

---

### Task 3: BookSourceManager UI

**Files:**
- Modify: `src/components/BookSourceManager.tsx`
- Test: `src/components/BookSourceManager.test.tsx`

- [ ] **Step 1: 复制/导出操作（书源列表项）**

```tsx
const handleCopy = async (s: BookSource) => {
  try {
    const text = JSON.stringify(JSON.parse(s.json), null, 2);
    await navigator.clipboard.writeText(text);
    setImportMsg(`已复制书源 JSON：${s.name}`);
  } catch (e) {
    showError(`复制失败：${String(e)}`);
  }
};

const handleExport = async (s: BookSource) => {
  try {
    const picked = await save({
      defaultPath: `${s.name}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!picked) return;
    await writeTextFile(picked, JSON.stringify(JSON.parse(s.json), null, 2));
    setImportMsg(`已导出：${picked}`);
  } catch (e) {
    showError(`导出失败：${String(e)}`);
  }
};

const handleExportAll = async () => {
  try {
    const picked = await save({ defaultPath: "书源合集.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!picked) return;
    const all = sources.map((s) => JSON.parse(s.json));
    await writeTextFile(picked, JSON.stringify(all, null, 2));
    setImportMsg(`已导出 ${all.length} 个书源`);
  } catch (e) {
    showError(`导出失败：${String(e)}`);
  }
};
```

- import：`import { save } from "@tauri-apps/plugin-dialog";` + `writeTextFile`。
- 列表项操作区追加「复制」「导出」按钮；顶部（导入标题旁）加「导出全部」按钮。

- [ ] **Step 2: 订阅源分区（页面底部新分区）**

```tsx
const [subs, setSubs] = useState<SubscriptionRow[]>([]);
const [subUrl, setSubUrl] = useState("");
const [syncBusy, setSyncBusy] = useState<number | null>(null);

const refreshSubs = useCallback(async () => {
  try { setSubs(await listSubscriptions()); } catch (e) { showError(String(e)); }
}, []);
useEffect(() => { void refreshSubs(); }, [refreshSubs]);

const handleAddSub = async () => {
  if (!subUrl.trim() || busy) return;
  setBusy(true);
  try {
    await addSubscription(subUrl.trim());
    setSubUrl("");
    await refreshSubs();
  } catch (e) { showError(String(e)); }
  finally { setBusy(false); }
};

const handleSyncSub = async (sub: SubscriptionRow) => {
  setSyncBusy(sub.id);
  try {
    const r = await syncSubscription(sub);
    await setSubscriptionChecked(sub.id);
    await refreshSubs();
    setImportMsg(`同步完成：新增 ${r.added}，更新 ${r.updated}，失败 ${r.failed}`);
  } catch (e) { showError(String(e)); }
  finally { setSyncBusy(null); }
};
```

UI：

```tsx
<h3 className="source-import-title">订阅源</h3>
<div className="source-import">
  <div className="source-import-row">
    <input aria-label="订阅源网址" value={subUrl} onChange={(e) => setSubUrl(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && void handleAddSub()} placeholder="订阅远程书源合集 JSON 地址" />
    <button className="btn btn-primary" onClick={handleAddSub} disabled={busy || !subUrl.trim()}>订阅</button>
  </div>
</div>
{subs.length === 0 ? <p className="panel-empty">暂无订阅源</p> : (
  <ul className="source-list">
    {subs.map((sub) => (
      <li key={sub.id}>
        <div className="source-info">
          <span className="source-name">{sub.name}</span>
          <span className="source-url">{sub.url}</span>
        </div>
        <div className="source-actions">
          <button className="btn btn-ghost" onClick={() => void handleSyncSub(sub)} disabled={syncBusy === sub.id}>
            {syncBusy === sub.id ? "同步中…" : "同步"}
          </button>
          <button className="btn btn-ghost" onClick={() => void (async () => { await deleteSubscription(sub.id); await refreshSubs(); })()}>删除</button>
        </div>
      </li>
    ))}
  </ul>
)}
```

- [ ] **Step 3: 测试（BookSourceManager.test.tsx）**

- 现有 api mock 补：`listSubscriptions: vi.fn().mockResolvedValue([])`、`addSubscription`、`deleteSubscription`、`setSubscriptionChecked`、`writeTextFile`（vi.mock("../services/api") 已有对象中加）。
- clipboard：mock `navigator.clipboard.writeText`（jsdom 可能无 clipboard → 直接赋值或 vi.stubGlobal）。
- 新增用例：复制按钮 → clipboard 调用；订阅添加 → addSubscription 调用；同步 → syncSubscription 调用（mock sourceSubscription 模块或走真实 + mock api.httpGet）。

注意：BookSourceManager.test.tsx 现有 vi.mock("../services/api") 不含新函数，需补充否则调用 undefined 报错。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/components/BookSourceManager.tsx src/components/BookSourceManager.test.tsx
git commit -m "feat: 书源导出/复制与订阅源管理 UI"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 sourceSubscription 3、BookSourceManager 用例）

- [ ] **Step 2: Rust 全量测试**

Run（src-tauri）: `cargo test`
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 4: 终审清单**

- [ ] Rust：订阅表 + 4 函数 + 6 命令 + 1 测试 ✓
- [ ] api.ts 封装 ✓
- [ ] sourceSubscription sync + 3 测试 ✓
- [ ] BookSourceManager 复制/导出/导出全部/订阅分区 ✓
- [ ] `npm test`、`cargo test`、`npm run build` 全绿、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 书源导出订阅终审修复`）。

- [ ] **Step 5: Commit（若终审有修复）**

```bash
git commit -am "fix: 书源导出订阅终审修复"
```

---
