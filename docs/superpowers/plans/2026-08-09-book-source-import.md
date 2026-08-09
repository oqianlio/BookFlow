# 书源导入方式重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 书源导入改为两种方式：本地文件导入（系统选择器选 .json）+ 网络导入（粘贴 URL 下载），移除手动粘贴 JSON 文本框。

**Architecture:** 新增纯函数解析层 `bookSourceImport.ts`（JSON/HTML 提取书源对象），BookSourceManager UI 提供「从文件导入」「从网址导入」两个入口，复用现有 `httpGet`/`readFileContent`/`addBookSource`。

**Tech Stack:** React + TS + Vitest, @tauri-apps/plugin-dialog

**Spec:** `docs/superpowers/specs/2026-08-09-book-source-import-design.md`

## Global Constraints

- 书源导入只有两种方式：文件选择器选 `.json` + 粘贴网址下载。移除手动粘贴 JSON 文本框。
- `extractBookSourceFromText(text)` 为纯函数：先 JSON.parse（对象/数组取第一个有效书源），失败则 HTML 提取（`<pre>`/`<textarea>` → 内联 `{"bookSourceUrl":`）。
- 导入复用现有：`httpGet(url, undefined, 20000)`（网址，20s 超时）、`readFileContent(path)`（文件）、`addBookSource(name, url, JSON.stringify(bookSource))`。
- UI 文案使用中文。
- 现有测试保持绿：`npm test`（75 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: 书源解析纯函数 `bookSourceImport.ts`

**Files:**
- Create: `src/services/bookSourceImport.ts`
- Create: `src/services/bookSourceImport.test.ts`

**Interfaces:**
- Produces:
  - `export function extractBookSourceFromText(text: string): any` — 从文本/HTML 提取书源对象（见 spec §4 规则），无结果抛中文错误。
  - `export async function importBookSourceFromUrl(url: string): Promise<{ name: string; url: string; bookSource: any }>` — `httpGet(url, undefined, 20000)` → 解析 → 校验，返回书源摘要。
  - `export async function importBookSourceFromFile(path: string): Promise<{ name: string; url: string; bookSource: any }>` — `readFileContent(path)` → 解析 → 校验。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceImport.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractBookSourceFromText } from "./bookSourceImport";

const VALID = { bookSourceName: "测试书源", bookSourceUrl: "https://ex.com" };

describe("extractBookSourceFromText", () => {
  it("parses a single JSON object", () => {
    expect(extractBookSourceFromText(JSON.stringify(VALID))).toMatchObject(VALID);
  });

  it("picks first valid from JSON array", () => {
    const arr = JSON.stringify([{ foo: 1 }, VALID, { bar: 2 }]);
    expect(extractBookSourceFromText(arr)).toMatchObject(VALID);
  });

  it("extracts from <pre> in HTML", () => {
    const html = `<html><body><pre>${JSON.stringify(VALID)}</pre></body></html>`;
    expect(extractBookSourceFromText(html)).toMatchObject(VALID);
  });

  it("extracts inline bookSource JSON in HTML", () => {
    const html = `<html><body><script>window.bookSource = ${JSON.stringify(VALID)};</script></body></html>`;
    expect(extractBookSourceFromText(html)).toMatchObject(VALID);
  });

  it("throws when no book source found", () => {
    expect(() => extractBookSourceFromText("<html><body>无内容</body></html>")).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceImport.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 bookSourceImport.ts**

```ts
import { addBookSource, httpGet, readFileContent } from "./api";

function tryParseBookSource(s: string): any {
  try {
    const obj = JSON.parse(s.trim());
    const cand = Array.isArray(obj) ? obj : [obj];
    return cand.find((x) => x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName) ?? null;
  } catch {
    return null;
  }
}

export function extractBookSourceFromText(text: string): any {
  const trimmed = text.trim();
  const direct = tryParseBookSource(trimmed);
  if (direct) return direct;

  const pre = /<(?:pre|textarea)[^>]*>([\s\S]*?)<\/(?:pre|textarea)>/i.exec(text);
  if (pre) {
    const hit = tryParseBookSource(pre[1]);
    if (hit) return hit;
  }

  const inline = /\{[^{}]*"bookSourceUrl"\s*:\s*"[^"]*"[^{}]*\}/.exec(text);
  if (inline) {
    const hit = tryParseBookSource(inline[0]);
    if (hit) return hit;
  }

  throw new Error("未能从内容中解析出书源，请确认是书源 JSON 文件或包含书源信息的网页");
}

export async function importBookSourceFromUrl(url: string): Promise<{ name: string; url: string; bookSource: any }> {
  if (!url.trim()) throw new Error("请输入书源网址");
  const text = await httpGet(url.trim(), undefined, 20000);
  const bookSource = extractBookSourceFromText(text);
  return { name: bookSource.bookSourceName, url: bookSource.bookSourceUrl, bookSource };
}

export async function importBookSourceFromFile(path: string): Promise<{ name: string; url: string; bookSource: any }> {
  const text = await readFileContent(path);
  const bookSource = extractBookSourceFromText(text);
  return { name: bookSource.bookSourceName, url: bookSource.bookSourceUrl, bookSource };
}

export async function commitBookSource(bookSource: any): Promise<number> {
  return addBookSource(bookSource.bookSourceName, bookSource.bookSourceUrl, JSON.stringify(bookSource));
}
```
> 注：`importBookSourceFromUrl`/`importBookSourceFromFile`/`commitBookSource` 依赖 api.ts（httpGet/readFileContent/addBookSource）——本任务只测纯函数 `extractBookSourceFromText`；异步函数在 Task 2 组件测试中通过 mock api 覆盖。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceImport.test.ts`
Expected: 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceImport.ts src/services/bookSourceImport.test.ts
git commit -m "feat: 书源文本解析纯函数"
```

---

### Task 2: 书源管理 UI 改为文件/网址导入

**Files:**
- Modify: `src/components/BookSourceManager.tsx`
- Modify: `src/components/BookSourceManager.test.tsx`
- Modify: `src/App.css`（样式）

**Interfaces:**
- Consumes: Task 1 的 `importBookSourceFromUrl` / `importBookSourceFromFile` / `commitBookSource`；现有 `listBookSources` / `deleteBookSource` / `setBookSourceEnabled`
- Produces:
  - `BookSourceManager` 移除粘贴 JSON 文本框与「添加书源」按钮。
  - 新增「从文件导入」按钮 → `open({ filters: [{ name: "JSON", extensions: ["json"] }] })` → `importBookSourceFromFile(path)` → `commitBookSource` → `refresh()`。
  - 新增「从网址导入」输入框（aria-label="书源网址"）+ 按钮 → `importBookSourceFromUrl(url)` → `commitBookSource` → `refresh()`，成功后清空输入框。
  - 导入失败 `setError` 中文提示。

- [ ] **Step 1: 写失败的测试**

`src/components/BookSourceManager.test.tsx` 重写：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookSourceManager from "./BookSourceManager";
import * as api from "../services/api";
import * as imp from "../services/bookSourceImport";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  deleteBookSource: vi.fn(),
  setBookSourceEnabled: vi.fn(),
  addBookSource: vi.fn(),
}));
vi.mock("../services/bookSourceImport", () => ({
  importBookSourceFromUrl: vi.fn(),
  importBookSourceFromFile: vi.fn(),
  commitBookSource: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue("C:/fake/source.json"),
}));

const sources = [
  { id: 1, name: "示例书源", url: "https://ex.com", json: "{}", enabled: true, last_used_at: null },
];

describe("BookSourceManager", () => {
  it("renders sources with enable toggle", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(sources);
    render(<BookSourceManager />);
    expect(await screen.findByText("示例书源")).toBeInTheDocument();
  });

  it("imports a source from URL", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      name: "网络书源", url: "https://net.com", bookSource: { bookSourceName: "网络书源", bookSourceUrl: "https://net.com" },
    });
    vi.mocked(imp.commitBookSource).mockResolvedValue(9);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/source.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalled());
  });

  it("imports a source from local file", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromFile).mockResolvedValue({
      name: "本地书源", url: "https://local.com", bookSource: { bookSourceName: "本地书源", bookSourceUrl: "https://local.com" },
    });
    vi.mocked(imp.commitBookSource).mockResolvedValue(10);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.click(screen.getByRole("button", { name: /从文件导入/ }));
    await waitFor(() => expect(imp.importBookSourceFromFile).toHaveBeenCalledWith("C:/fake/source.json"));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: FAIL（组件仍为旧实现，无「从网址导入」/「从文件导入」按钮）。

- [ ] **Step 3: 实现 BookSourceManager.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { deleteBookSource, listBookSources, setBookSourceEnabled, type BookSource } from "../services/api";
import { commitBookSource, importBookSourceFromFile, importBookSourceFromUrl } from "../services/bookSourceImport";

export default function BookSourceManager() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleFileImport = async () => {
    setError(null);
    try {
      const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const result = await importBookSourceFromFile(path);
      await commitBookSource(result.bookSource);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importBookSourceFromUrl(url.trim());
      await commitBookSource(result.bookSource);
      setUrl("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await deleteBookSource(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleEnable = async (id: number, enabled: boolean) => {
    setError(null);
    try {
      await setBookSourceEnabled(id, enabled);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="book-source-manager">
      <h3>书源</h3>
      {error && <p className="error">{error}</p>}
      {sources.length === 0 ? (
        <p className="panel-empty">暂无书源</p>
      ) : (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <div className="source-info">
                <span className="source-name">{s.name}</span>
                <span className="source-url">{s.url}</span>
              </div>
              <div className="source-actions">
                <input
                  type="checkbox"
                  aria-label={`启用 ${s.name}`}
                  checked={s.enabled}
                  onChange={(e) => void handleToggleEnable(s.id, e.target.checked)}
                />
                <button className="btn btn-ghost" onClick={() => void handleDelete(s.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="source-import">
        <button className="btn btn-ghost" onClick={() => void handleFileImport()}>从文件导入</button>
        <div className="source-import-row">
          <input
            aria-label="书源网址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleUrlImport()}
            placeholder="粘贴书源 JSON 网址"
          />
          <button className="btn btn-primary" onClick={() => void handleUrlImport()} disabled={busy || !url.trim()}>
            {busy ? "导入中…" : "从网址导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`src/App.css` 追加：
```css
.source-import { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.source-import-row { display: flex; gap: 8px; }
.source-import-row input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font-size: 13px; }
.source-import-row input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: 3 个测试 PASS。

- [ ] **Step 5: 全量验证 + 提交**

Run: `npm test`（75+3 全绿）与 `npm run build`。
```bash
git add src/
git commit -m "feat: 书源改为文件/网址导入"
```

---

## 已知限制（记录于 spec 附录）

- 网络导入仅支持纯 JSON 或 HTML 内嵌书源信息的页面；动态 JS 渲染页无法处理。
- 文件导入仅 `.json` 扩展名。
