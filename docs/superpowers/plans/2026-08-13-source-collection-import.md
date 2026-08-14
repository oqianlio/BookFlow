# 书源合集导入（确认列表）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持导入书源合集（JSON 数组），导入前展示书源列表供确认（默认全选、可勾选），确认后批量导入并去重。

**Architecture:** 解析层（`bookSourceImport.ts`）新增 `parseBookSourceCollection` 返回全部书源数组；`importBookSourceFromUrl/File` 改为返回 `{ bookSources: BookSource[] }`；`BookSourceManager` 收到多书源时展示确认面板，批量提交 + 按已有 URL 去重。

**Tech Stack:** TypeScript + vitest（jsdom）+ React Testing Library。无新依赖。

## Global Constraints

- `extractBookSourceFromText` 保留为**单书源**返回（现有测试依赖，且网页导入场景需要），新数组逻辑走 `parseBookSourceCollection`。
- 后端 `add_source` 无 UNIQUE 约束：去重在前端做（用 `listBookSources()` 的已有 URL 集合）。
- 单个书源提交失败 → 计入跳过数，不中断批量。
- 合集含 JS 书源 → 确认列表标记「含脚本」，勾选即接受，不逐个弹框。
- 现有测试保持绿：`npm test`（当前 204），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/bookSourceImport.ts` | 新增 parseBookSourceCollection；import 返回数组 | 修改 |
| `src/services/bookSourceImport.test.ts` | parse/import 数组测试 | 修改 |
| `src/components/BookSourceManager.tsx` | 确认面板 + 批量导入 + 去重 | 修改 |
| `src/components/BookSourceManager.test.tsx` | 合集确认流程测试 | 修改 |
| `src/App.css` | 确认面板样式 `.import-confirm-*` | 修改 |

## 任务依赖

Task 1（解析层）→ Task 2（BookSourceManager 确认面板 + 批量导入）。

---

### Task 1: 解析层支持数组

**Files:**
- Modify: `src/services/bookSourceImport.ts`
- Test: `src/services/bookSourceImport.test.ts`

**Interfaces:**
- Consumes: `httpGet`/`readFileContent` from `./api`（现有）。
- Produces:
  ```ts
  export function parseBookSourceCollection(text: string): any[];
  // importBookSourceFromUrl / importBookSourceFromFile 返回类型改为：
  // Promise<{ bookSources: any[] }>
  ```
  - `parseBookSourceCollection`：JSON 数组（过滤含 bookSourceUrl+bookSourceName 的对象）或单对象 → 数组；非法 → 抛错。
  - `extractBookSourceFromText` 保持现有单书源行为不变。

- [ ] **Step 1: 写失败测试（追加到 bookSourceImport.test.ts）**

```ts
describe("parseBookSourceCollection", () => {
  it("returns all sources from a JSON array", () => {
    const arr = JSON.stringify([VALID, { bookSourceName: "书源2", bookSourceUrl: "https://e2.com" }]);
    const r = parseBookSourceCollection(arr);
    expect(r.length).toBe(2);
    expect(r[0]).toMatchObject(VALID);
    expect(r[1]).toMatchObject({ bookSourceName: "书源2" });
  });

  it("returns single source wrapped in array", () => {
    expect(parseBookSourceCollection(JSON.stringify(VALID))).toHaveLength(1);
  });

  it("filters out invalid entries in array", () => {
    const arr = JSON.stringify([{ foo: 1 }, VALID]);
    const r = parseBookSourceCollection(arr);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject(VALID);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseBookSourceCollection("not json")).toThrow();
  });
});

describe("import functions return bookSources array", () => {
  it("importBookSourceFromUrl returns bookSources array", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(JSON.stringify([VALID, { bookSourceName: "B", bookSourceUrl: "https://b.com" }]));
    const r = await importBookSourceFromUrl("https://x.json");
    expect(r.bookSources).toHaveLength(2);
    expect(r.bookSources[0]).toMatchObject(VALID);
  });

  it("importBookSourceFromFile returns bookSources array", async () => {
    vi.mocked(api.readFileContent).mockResolvedValue(JSON.stringify(VALID));
    const r = await importBookSourceFromFile("C:/s.json");
    expect(r.bookSources).toHaveLength(1);
    expect(r.bookSources[0]).toMatchObject(VALID);
  });
});
```

文件顶部 import 追加 `parseBookSourceCollection`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceImport.test.ts`
Expected: FAIL（`parseBookSourceCollection` 不存在 / import 返回单对象）

- [ ] **Step 3: 实现解析层**

`bookSourceImport.ts` 改造：

```ts
function tryParseBookSourceList(s: string): any[] | null {
  try {
    const obj = JSON.parse(s.trim());
    if (Array.isArray(obj)) {
      const valid = obj.filter((x) => x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName);
      return valid.length > 0 ? valid : null;
    }
    if (obj && typeof obj === "object" && obj.bookSourceUrl && obj.bookSourceName) {
      return [obj];
    }
    return null;
  } catch {
    return null;
  }
}

export function parseBookSourceCollection(text: string): any[] {
  const trimmed = text.trim();
  const direct = tryParseBookSourceList(trimmed);
  if (direct) return direct;

  const pre = /<(?:pre|textarea)[^>]*>([\s\S]*?)<\/(?:pre|textarea)>/i.exec(text);
  if (pre) {
    const hit = tryParseBookSourceList(pre[1]);
    if (hit) return hit;
  }

  const inline = /\{[^{}]*"bookSourceUrl"\s*:\s*"[^"]*"[^{}]*\}/.exec(text);
  if (inline) {
    const hit = tryParseBookSourceList(inline[0]);
    if (hit) return hit;
  }

  throw new Error("未能从内容中解析出书源，请确认是书源 JSON 文件或包含书源信息的网页");
}

// 保留单书源提取（现有测试/网页导入兼容）
export function extractBookSourceFromText(text: string): any {
  const list = parseBookSourceCollection(text);
  return list[0];
}
```

`importBookSourceFromUrl` / `importBookSourceFromFile` 改为：

```ts
export async function importBookSourceFromUrl(url: string): Promise<{ bookSources: any[] }> {
  if (!url.trim()) throw new Error("请输入书源网址");
  const text = await httpGet(url.trim(), undefined, 20000);
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}

export async function importBookSourceFromFile(path: string): Promise<{ bookSources: any[] }> {
  const text = await readFileContent(path);
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/bookSourceImport.test.ts`
Expected: 全部 PASS（既有 `extractBookSourceFromText` 测试——注意 line "picks first valid from JSON array" 现改为走 parseBookSourceCollection[0]，语义一致，应仍通过）

- [ ] **Step 5: 全量测试 + 构建**

Run: `npm test`（204 绿）；`npm run build` 通过。
注意：`BookSourceManager.test.tsx` 现有 mock `importBookSourceFromUrl` 返回 `{ name, url, bookSource }` 单对象——Task 2 会改，**本任务先跑全量确认只有该组件测试因签名变化失败属预期**；若不改则本任务内修复该 mock 为新签名。

- [ ] **Step 6: Commit**

```bash
git add src/services/bookSourceImport.ts src/services/bookSourceImport.test.ts
git commit -m "feat: 书源解析层支持合集数组"
```

---

### Task 2: BookSourceManager 确认面板 + 批量导入

**Files:**
- Modify: `src/components/BookSourceManager.tsx`
- Test: `src/components/BookSourceManager.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `parseBookSourceCollection`（经 import 函数）；`sourceUsesJs`/`commitBookSource`（现有）；`listBookSources`（现有）。
- Produces:
  - `BookSourceManager` 新增内部 state：`pendingSources: any[] | null`、`selected: Set<number>`、`importMsg: string | null`。
  - 处理 import 返回 `{ bookSources }`：length===1 走现有单书源流程；length>1 展示确认面板。

- [ ] **Step 1: 写失败测试（追加到 BookSourceManager.test.tsx）**

```tsx
it("shows confirm list and imports selected collection sources", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([]);
  vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
    bookSources: [
      { bookSourceName: "A源", bookSourceUrl: "https://a.com" },
      { bookSourceName: "B源", bookSourceUrl: "https://b.com" },
    ],
  });
  vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
  vi.mocked(imp.commitBookSource).mockResolvedValue(1);
  render(<BookSourceManager />);
  await screen.findByText(/暂无书源/);
  await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/collection.json");
  await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
  await waitFor(() => expect(screen.getByText("A源")).toBeInTheDocument());
  expect(screen.getByText("B源")).toBeInTheDocument();
  // 默认全选 → 取消 B
  await userEvent.click(screen.getByRole("checkbox", { name: /B源/ }));
  await userEvent.click(screen.getByRole("button", { name: /导入选中/ }));
  await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalledTimes(1));
  expect(imp.commitBookSource).toHaveBeenCalledWith(expect.objectContaining({ bookSourceName: "A源" }));
});

it("skips existing URLs when importing collection", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([
    { id: 1, name: "A源", url: "https://a.com", json: "{}", enabled: true, last_used_at: null },
  ]);
  vi.mocked(imp.importBookSourceFromFile).mockResolvedValue({
    bookSources: [
      { bookSourceName: "A源", bookSourceUrl: "https://a.com" },
      { bookSourceName: "B源", bookSourceUrl: "https://b.com" },
    ],
  });
  vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
  vi.mocked(imp.commitBookSource).mockResolvedValue(2);
  render(<BookSourceManager />);
  await screen.findByText("A源");
  await userEvent.click(screen.getByRole("button", { name: /从文件导入/ }));
  await waitFor(() => expect(screen.getByText(/成功导入 1 个，跳过 1 个/)).toBeInTheDocument());
  expect(imp.commitBookSource).toHaveBeenCalledTimes(1);
  expect(imp.commitBookSource).toHaveBeenCalledWith(expect.objectContaining({ bookSourceName: "B源" }));
});

it("marks JS sources in the confirm list", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([]);
  vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
    bookSources: [
      { bookSourceName: "J源", bookSourceUrl: "https://j.com", searchUrl: "@js:var a=1;" },
    ],
  });
  vi.mocked(imp.sourceUsesJs).mockReturnValue(true);
  render(<BookSourceManager />);
  await screen.findByText(/暂无书源/);
  await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/c.json");
  await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
  await waitFor(() => expect(screen.getByText(/含脚本/)).toBeInTheDocument());
});
```

注意：现有 mock（line 51-53、66-68、79-82、98-101）返回 `{ name, url, bookSource }` 单对象——需同步改为 `{ bookSources: [...] }`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: FAIL（无确认面板 / import 新签名）

- [ ] **Step 3: 实现 BookSourceManager**

```tsx
// 新增 state
const [pendingSources, setPendingSources] = useState<any[] | null>(null);
const [selected, setSelected] = useState<Set<number>>(new Set());
const [importMsg, setImportMsg] = useState<string | null>(null);

// handleFileImport 内，importBookSourceFromFile 返回后：
const result = await importBookSourceFromFile(path);
await handleImportResult(result.bookSources);

// handleUrlImport 内同理
const result = await importBookSourceFromUrl(url.trim());
await handleImportResult(result.bookSources);
setUrl("");

const handleImportResult = async (bookSources: any[]) => {
  if (bookSources.length === 1) {
    const bs = bookSources[0];
    if (!confirmJsImport(bs)) return;
    await commitBookSource(bs);
    await refresh();
    return;
  }
  setPendingSources(bookSources);
  setSelected(new Set(bookSources.map((_, i) => i)));
  setImportMsg(null);
};

const confirmImportSelection = async () => {
  if (!pendingSources) return;
  const existing = new Set((await listBookSources()).map((s) => s.url));
  let added = 0, skipped = 0;
  for (const i of selected) {
    const bs = pendingSources[i];
    if (existing.has(bs.bookSourceUrl)) { skipped++; continue; }
    try {
      await commitBookSource(bs);
      added++;
    } catch {
      skipped++;
    }
  }
  setImportMsg(`成功导入 ${added} 个，跳过 ${skipped} 个`);
  setPendingSources(null);
  await refresh();
};

const toggleSelect = (i: number) => {
  const next = new Set(selected);
  if (next.has(i)) next.delete(i); else next.add(i);
  setSelected(next);
};
```

渲染（在 `source-import` 区之后）：

```tsx
{pendingSources && (
  <div className="import-confirm">
    <h4>确认导入书源</h4>
    <ul className="import-confirm-list">
      {pendingSources.map((bs, i) => (
        <li key={i}>
          <input
            type="checkbox"
            aria-label={bs.bookSourceName}
            checked={selected.has(i)}
            onChange={() => toggleSelect(i)}
          />
          <span className="import-confirm-name">{bs.bookSourceName}</span>
          <span className="import-confirm-url">{bs.bookSourceUrl}</span>
          {sourceUsesJs(bs) && <span className="import-confirm-js">含脚本</span>}
        </li>
      ))}
    </ul>
    <div className="import-confirm-actions">
      <button className="btn btn-primary" onClick={() => void confirmImportSelection()} disabled={selected.size === 0}>
        导入选中 {selected.size} 个
      </button>
      <button className="btn btn-ghost" onClick={() => setPendingSources(null)}>取消</button>
    </div>
  </div>
)}
{importMsg && <p className="error import-msg">{importMsg}</p>}
```

删除 `handleFileImport` 里对 `result.bookSource` 的引用（改走 `handleImportResult`）。确认 `confirmJsImport` 仍用于单书源。

- [ ] **Step 4: 确认面板样式（App.css 追加）**

```css
.import-confirm { margin-top: 14px; border: 1px solid var(--outline-variant); border-radius: var(--radius-md); padding: 14px 16px; background: var(--surface-container-lowest); }
.import-confirm h4 { margin: 0 0 10px; font-size: 14px; color: var(--on-surface); }
.import-confirm-list { list-style: none; margin: 0 0 12px; padding: 0; max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.import-confirm-list li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-container-low); }
.import-confirm-name { font-size: 13px; font-weight: 600; color: var(--on-surface); min-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-confirm-url { font-size: 11.5px; color: var(--on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.import-confirm-js { flex-shrink: 0; font-size: 11px; color: var(--primary); padding: 2px 8px; border-radius: 999px; background: var(--secondary-container); }
.import-confirm-actions { display: flex; gap: 10px; }
.import-msg { margin: 10px 0 0; }
```

- [ ] **Step 5: 更新既有 mock + 运行测试**

将现有 4 处 `importBookSourceFromUrl/File` mock 返回值改为 `{ bookSources: [...] }` 单元素数组。运行 `npx vitest run src/components/BookSourceManager.test.tsx` PASS。

- [ ] **Step 6: 全量测试 + 构建**

Run: `npm test`（全绿）；`npm run build` 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/BookSourceManager.tsx src/components/BookSourceManager.test.tsx src/App.css
git commit -m "feat: 书源合集导入确认列表 + 批量导入去重"
```

---
