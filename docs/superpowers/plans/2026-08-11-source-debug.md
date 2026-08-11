# 子项目6：书源调试器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「枕书」实现书源调试器：书源管理里对每个书源提供调试入口，输入 URL/关键词选择阶段，分步显示书源规则各字段的提取结果与 HTML 摘要。

**Architecture:** 新建 `src/services/sourceDebug.ts`（纯逻辑：按阶段运行书源规则返回字段结果）；新建 `DebugSourcePage` 调试页；`BookSourceManager` 加「调试」按钮；`App.tsx` 加 `debugSource` view。

**Tech Stack:** React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-11-source-debug-design.md`

## Global Constraints

- `debugSource(bs, stage, urlOrKey, key?)` 返回 `{ html: string; fields: Array<{ name: string; value: string }> }`。
- 阶段：`search`（用关键词跑 searchUrl + ruleSearch）/ `toc`（URL 书籍页 → ruleBookInfo + ruleToc）/ `content`（URL 章节页 → ruleContent）。
- 复用 `httpGet`（含 cookieJar、sourceKey）与现有引擎提取。
- 列表字段值截断展示（~200 字符），HTML 摘要截断（~500 字符）。
- UI 文案使用中文（调试/URL/关键词/阶段/运行/HTML 摘要/重试 etc.）。
- 现有测试保持绿：`npm test`（163 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: sourceDebug 纯逻辑

**Files:**
- Create: `src/services/sourceDebug.ts`
- Create: `src/services/sourceDebug.test.ts`

**Interfaces:**
- Produces:
  - `export interface DebugResult { html: string; fields: Array<{ name: string; value: string }> }`
  - `export async function debugSource(bs: { json: string }, stage: "search" | "toc" | "content", urlOrKey: string): Promise<DebugResult>`

- [ ] **Step 1: 写失败的测试**

`src/services/sourceDebug.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { debugSource } from "./sourceDebug";
import * as api from "./api";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  listBookSources: vi.fn(),
  mergeUserAgent: vi.fn((h?: any) => h),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  searchUrl: "https://ex.com/search?q={{key}}",
  ruleSearch: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: { chapterList: "ol a", chapterName: "@text", chapterUrl: "@href" },
  ruleContent: { content: "#content@text" },
});

beforeEach(() => { vi.clearAllMocks(); });

describe("debugSource", () => {
  it("search stage extracts ruleSearch fields", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    const r = await debugSource({ json: sourceJson }, "search", "三体");
    expect(r.html.length).toBeGreaterThan(0);
    const name = r.fields.find((f) => f.name === "name");
    expect(name?.value).toBe("三体");
    const bookList = r.fields.find((f) => f.name === "bookList");
    expect(bookList?.value).toContain("三体");
  });

  it("toc stage extracts ruleBookInfo and ruleToc", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>书名</h1><span class="author">作者</span><ol><a href="/c/1">章1</a><a href="/c/2">章2</a></ol></body></html>`,
    );
    const r = await debugSource({ json: sourceJson }, "toc", "https://ex.com/book/1.html");
    const name = r.fields.find((f) => f.name === "name");
    expect(name?.value).toBe("书名");
    const chapterList = r.fields.find((f) => f.name === "chapterList");
    expect(chapterList?.value).toContain("章1");
  });

  it("content stage extracts ruleContent", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content">正文内容</div></body></html>`,
    );
    const r = await debugSource({ json: sourceJson }, "content", "https://ex.com/c/1.html");
    const content = r.fields.find((f) => f.name === "content");
    expect(content?.value).toBe("正文内容");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/sourceDebug.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 sourceDebug.ts**

```ts
import { parseBookSourceJson, parseHtml, extractSingle, extractList, resolveSearchUrl, type BookSource as Src } from "./bookSourceEngine";
import { httpGet, mergeUserAgent } from "./api";

export interface DebugResult {
  html: string;
  fields: Array<{ name: string; value: string }>;
}

export async function debugSource(
  bs: { json: string },
  stage: "search" | "toc" | "content",
  urlOrKey: string,
): Promise<DebugResult> {
  const src: Src = parseBookSourceJson(bs.json);
  const ua = mergeUserAgent(src.httpHeaders, src.httpUserAgent);
  let host = "";
  try { host = new URL(src.bookSourceUrl).hostname; } catch { /* ignore */ }

  let html: string;
  if (stage === "search") {
    const parsed = resolveSearchUrl(src.searchUrl ?? "", urlOrKey, 1, { sourceKey: src.bookSourceUrl });
    html = await httpGet(parsed.url, ua, undefined, parsed.method, parsed.body, undefined, host);
  } else {
    html = await httpGet(urlOrKey, ua, undefined, undefined, undefined, undefined, host);
  }
  const doc = parseHtml(html);
  const ctx = { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl };
  const fields: Array<{ name: string; value: string }> = [];

  if (stage === "search") {
    for (const k of ["bookList", "name", "author", "coverUrl", "bookUrl"]) {
      const rule = src.ruleSearch?.[k];
      if (!rule) continue;
      let v: string;
      if (k === "bookList") {
        const items = extractList(doc, rule, { name: "a@text", author: "a@text", bookUrl: "a@href" }, ctx);
        v = JSON.stringify(items).slice(0, 200);
      } else {
        v = extractSingle(doc, rule, ctx);
      }
      fields.push({ name: k, value: v });
    }
  } else if (stage === "toc") {
    for (const k of ["name", "author", "intro", "tocUrl"]) {
      const rule = src.ruleBookInfo?.[k];
      if (!rule) continue;
      fields.push({ name: k, value: extractSingle(doc, rule, ctx) });
    }
    for (const k of ["chapterList", "chapterName", "chapterUrl"]) {
      const rule = src.ruleToc?.[k];
      if (!rule) continue;
      let v: string;
      if (k === "chapterList") {
        const items = extractList(doc, rule, { name: "@text", url: "@href" }, ctx);
        v = JSON.stringify(items).slice(0, 200);
      } else {
        v = extractSingle(doc, rule, ctx);
      }
      fields.push({ name: k, value: v });
    }
  } else {
    for (const k of ["content", "nextContentUrl"]) {
      const rule = src.ruleContent?.[k];
      if (!rule) continue;
      fields.push({ name: k, value: extractSingle(doc, rule, ctx) });
    }
  }

  return { html: html.slice(0, 500), fields };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/sourceDebug.test.ts`
Expected: 3 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/sourceDebug.ts src/services/sourceDebug.test.ts
git commit -m "feat: 书源调试纯逻辑"
```

---

### Task 2: DebugSourcePage + 入口 + 路由

**Files:**
- Create: `src/pages/DebugSourcePage.tsx`
- Create: `src/pages/DebugSourcePage.test.tsx`
- Modify: `src/components/BookSourceManager.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 1 `debugSource`；`listBookSources`（选书源）
- Produces:
  - `export default function DebugSourcePage({ sourceId, sourceName, onBack }: { sourceId: number; sourceName: string; onBack: () => void })`
  - `BookSourceManager` 加 `onDebug?: (sourceId: number, sourceName: string) => void` prop + 每个书源「调试」按钮
  - `App.tsx` 加 `debugSource` view：`{ name: "debugSource"; sourceId: number; sourceName: string }`

- [ ] **Step 1: 写失败的测试**

`src/pages/DebugSourcePage.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DebugSourcePage from "./DebugSourcePage";
import * as api from "../services/api";
import * as dbg from "../services/sourceDebug";

vi.mock("../services/api", () => ({ listBookSources: vi.fn() }));
vi.mock("../services/sourceDebug", () => ({ debugSource: vi.fn() }));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  searchUrl: "https://ex.com/search?q={{key}}",
  ruleSearch: { name: ".n@text" },
  ruleContent: { content: "#c@text" },
});

describe("DebugSourcePage", () => {
  it("runs a stage and shows fields", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "测试", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(dbg.debugSource).mockResolvedValue({
      html: "<html>摘要</html>",
      fields: [{ name: "name", value: "三体" }],
    });
    render(<DebugSourcePage sourceId={1} sourceName="测试" onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText("URL 或关键词"), "三体");
    await userEvent.click(screen.getByRole("button", { name: /运行/ }));
    expect(await screen.findByText("name")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/DebugSourcePage.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现**

`DebugSourcePage.tsx`（概览）：
- state: `url`（URL 或关键词）、`stage`（search/toc/content）、`result`、`error`、`busy`。
- 从 `listBookSources` 取书源 → `debugSource(bs, stage, url)`。
- 渲染：URL 输入（`aria-label="URL 或关键词"`）+ 阶段选择（三个按钮）+ 运行按钮 + HTML 摘要区 + 字段列表（name/value 两列）。
- 中文文案：调试 / URL 或关键词 / 搜索 / 目录 / 正文 / 运行 / HTML 摘要 / 重试 / 返回。

`BookSourceManager.tsx`：`onDebug?` prop；每个书源 `.source-actions` 加「调试」按钮 `onClick={() => onDebug?.(s.id, s.name)}`。

`App.tsx`：`debugSource` view；SettingsPage 分支的 `BookSourceManager` 需拿到 `onDebug` —— App 的 settings view 传 `onOpenDebug` 给 SettingsPage → BookSourceManager。或简化：BookSourceManager 直接用 `window`/全局导航。推荐 App 管理 view，SettingsPage 加 `onOpenDebug` prop 透传。

`App.css`：`.debug-*` 样式（输入行、字段列表、HTML 摘要）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/pages/DebugSourcePage.test.tsx` + `npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/pages/DebugSourcePage.tsx src/pages/DebugSourcePage.test.tsx src/components/BookSourceManager.tsx src/App.tsx src/App.css
git commit -m "feat: 书源调试器页面"
```

---

## 已知限制（记录于 spec 附录）

- 调试为只读查看，不支持规则在线编辑。
- 列表字段值截断展示（完整值可复制 HTML）。
- 不实现 WebSocket 远程调试。
