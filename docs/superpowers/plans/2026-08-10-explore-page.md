# 子项目1：探索页（ruleExplore）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「发现」页实现 legado 书源的分类/排行榜浏览（`exploreUrl` + `ruleExplore`），支持分类入口、分页、进入书籍阅读。

**Architecture:** `parseExploreUrl` 解析 `exploreUrl` 分类列表；新增 `extractBookList` 共享 helper（搜索/探索复用）；新建 `ExplorePage` 展示分类与书籍列表，复用现有 `SearchHit` 卡片模型与 SourceBookPage 阅读流；DiscoverPage 提供浏览入口。

**Tech Stack:** React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-10-explore-page-design.md`

## Global Constraints

- `parseExploreUrl`：按行解析 `分类名::URL`，`\n` 分隔，忽略空行；无 `::` 时整行作 title 与 url。
- `extractBookList(doc, rules, ctx)`：从 itemRules（bookList/name/author/coverUrl/bookUrl）提取书籍列表，供搜索与探索共用。
- `ExplorePage` 复用 `SearchHit`；`{{page}}` 分页（URL 无 `{{page}}` 则隐藏分页）。
- UI 文案使用中文（浏览/分类/下一页/加载中…/返回 etc.）。
- 现有测试保持绿：`npm test`（119 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: `parseExploreUrl` + `extractBookList` 引擎函数

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Produces:
  - `export function parseExploreUrl(exploreUrl: string): Array<{ title: string; url: string }>`
  - `export function extractBookList(doc: Document, rules: Record<string, string>, ctx: { baseUrl?: string; result?: string }): Array<Record<string, string>>`

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { parseExploreUrl, extractBookList, extractFromJsObject } from "./bookSourceEngine";

describe("parseExploreUrl", () => {
  it("parses category::url lines", () => {
    const r = parseExploreUrl("玄幻::/sort/1_{{page}}.html\n都市::/sort/2_{{page}}.html");
    expect(r).toEqual([
      { title: "玄幻", url: "/sort/1_{{page}}.html" },
      { title: "都市", url: "/sort/2_{{page}}.html" },
    ]);
  });

  it("filters empty lines", () => {
    const r = parseExploreUrl("玄幻::/a.html\n\n\n都市::/b.html");
    expect(r.length).toBe(2);
  });

  it("handles lines without ::", () => {
    const r = parseExploreUrl("仅标题");
    expect(r).toEqual([{ title: "仅标题", url: "仅标题" }]);
  });
});

describe("extractBookList", () => {
  it("extracts books from itemRules", () => {
    const doc = parseHtml(`<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li><li><a class="n" href="/b/2">活着</a><span class="a">余华</span></li></ul>`);
    const rules = { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" };
    const books = extractBookList(doc, rules, { baseUrl: "https://ex.com" });
    expect(books.length).toBe(2);
    expect(books[0].name).toBe("三体");
    expect(books[1].bookUrl).toBe("https://ex.com/b/2");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `parseExploreUrl`/`extractBookList` 不存在 FAIL。

- [ ] **Step 3: 实现**

`bookSourceEngine.ts` 追加：
```ts
export function parseExploreUrl(exploreUrl: string): Array<{ title: string; url: string }> {
  return exploreUrl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("::");
      if (idx === -1) return { title: line, url: line };
      return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
    });
}

export function extractBookList(
  doc: Document,
  rules: Record<string, string>,
  ctx: { baseUrl?: string; result?: string },
): Array<Record<string, string>> {
  const itemRules: Record<string, string> = {};
  for (const k of ["name", "author", "coverUrl", "bookUrl"] as const) {
    if (rules[k]) itemRules[k] = rules[k];
  }
  return extractList(doc, rules.bookList ?? "", itemRules, { baseUrl: ctx.baseUrl, result: ctx.result });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 新增 4 个测试 + 现有全过。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: parseExploreUrl 与 extractBookList"
```

---

### Task 2: ExplorePage 组件

**Files:**
- Create: `src/pages/ExplorePage.tsx`
- Create: `src/pages/ExplorePage.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 1 `parseExploreUrl`/`extractBookList`；现有 `httpGet`/`listBookSources`/`mergeUserAgent`/`parseBookSourceJson`/`resolveUrl`；`SearchHit` 从 DiscoverPage 导出
- Produces:
  - `export default function ExplorePage({ sourceId, sourceName, onBack, onOpenBook }: { sourceId: number; sourceName: string; onBack: () => void; onOpenBook: (h: SearchHit) => void })`

- [ ] **Step 1: 写失败的测试**

`src/pages/ExplorePage.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExplorePage from "./ExplorePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: vi.fn((h?: any) => h),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  exploreUrl: "玄幻::/sort/1_{{page}}.html\n都市::/sort/2_{{page}}.html",
  ruleExplore: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
});

describe("ExplorePage", () => {
  it("renders categories and fetches books on click", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "测试", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    render(<ExplorePage sourceId={1} sourceName="测试" onBack={() => {}} onOpenBook={() => {}} />);
    expect(await screen.findByText("玄幻")).toBeInTheDocument();
    expect(screen.getByText("都市")).toBeInTheDocument();
    await userEvent.click(screen.getByText("玄幻"));
    expect(await screen.findByText("三体")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/ExplorePage.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现 ExplorePage.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import { httpGet, listBookSources, mergeUserAgent } from "../services/api";
import { parseBookSourceJson, parseExploreUrl, extractBookList, parseHtml, resolveUrl, type BookSource as Src } from "../services/bookSourceEngine";
import type { SearchHit } from "./DiscoverPage";

export default function ExplorePage({ sourceId, sourceName, onBack, onOpenBook }: {
  sourceId: number; sourceName: string; onBack: () => void; onOpenBook: (h: SearchHit) => void;
}) {
  const [categories, setCategories] = useState<Array<{ title: string; url: string }>>([]);
  const [books, setBooks] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ title: string; url: string } | null>(null);
  const [page, setPage] = useState(1);
  const [src, setSrc] = useState<Src | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bs = (await listBookSources()).find((s) => s.id === sourceId);
        if (!bs) { setError("书源不存在"); return; }
        const s = parseBookSourceJson(bs.json);
        if (cancelled) return;
        setSrc(s);
        setCategories(parseExploreUrl(s.exploreUrl ?? ""));
      } catch (e) { if (!cancelled) setError(String(e)); }
    })();
    return () => { cancelled = true; };
  }, [sourceId]);

  const loadCategory = useCallback(async (cat: { title: string; url: string }, pg: number) => {
    if (!src) return;
    setBusy(true); setError(null);
    try {
      const rawUrl = cat.url.replace("{{page}}", String(pg));
      const url = resolveUrl(rawUrl, src.bookSourceUrl);
      const html = await httpGet(url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined);
      const doc = parseHtml(html);
      const rules = src.ruleExplore ?? {};
      const items = extractBookList(doc, rules, { baseUrl: src.bookSourceUrl, result: html });
      setBooks(items.filter((i) => i.name).map((i) => ({
        title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
        bookUrl: i.bookUrl ?? "", sourceId, sourceName,
      })));
      setActive(cat); setPage(pg);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [src, sourceId, sourceName]);

  const canPage = active ? active.url.includes("{{page}}") : false;

  return (
    <div className="discover page">
      <header className="library-header">
        <div className="brand"><h1>{sourceName} · 浏览</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="explore-cats">
        {categories.length === 0 ? <p className="panel-empty">此书源无分类</p> : categories.map((c) => (
          <button key={c.url} className={`btn btn-ghost${active?.url === c.url ? " active" : ""}`} onClick={() => void loadCategory(c, 1)}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="discover-results">
        {busy ? <p className="panel-empty">加载中…</p> : books.length === 0 ? (
          active ? <p className="panel-empty">该分类暂无书籍</p> : <p className="panel-empty">选择一个分类开始浏览</p>
        ) : (
          <>
            {books.map((h, i) => (
              <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onOpenBook(h)}>
                <div className="hit-info">
                  <span className="hit-title">{h.title}</span>
                  <span className="hit-author">{h.author}</span>
                </div>
                <span className="hit-source">{h.sourceName}</span>
              </div>
            ))}
            {canPage && (
              <button className="btn btn-ghost" onClick={() => active && void loadCategory(active, page + 1)} disabled={busy}>
                下一页
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```
> 注：`SearchHit` 从 DiscoverPage 导出（已导出）。

`src/App.css` 追加：
```css
.explore-cats { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0 16px; }
.explore-cats .btn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/pages/ExplorePage.test.tsx`
Expected: 1 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/pages/ExplorePage.tsx src/pages/ExplorePage.test.tsx src/App.css
git commit -m "feat: 探索页组件"
```

---

### Task 3: DiscoverPage 浏览入口 + App 路由

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/DiscoverPage.test.tsx`

**Interfaces:**
- Consumes: Task 1-2 全部
- Produces:
  - `DiscoverPage` 在搜索框下方显示已启用书源的「浏览」入口（书源名按钮 → onOpenExplore(sourceId, sourceName)）。
  - `DiscoverPage` 新增 prop `onOpenExplore?: (sourceId: number, sourceName: string) => void`（可选，兼容现有测试）。
  - `App.tsx` 新增 `explore` view：`{ name: "explore"; sourceId: number; sourceName: string }`。

- [ ] **Step 1: 写失败的测试**

`src/pages/DiscoverPage.test.tsx` 追加（或新建 describe）：
```tsx
it("shows explore entry for enabled sources with exploreUrl", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([
    { id: 1, name: "有浏览", url: "https://ex.com", json: JSON.stringify({ bookSourceUrl: "https://ex.com", bookSourceName: "有浏览", exploreUrl: "分类::/x.html" }), enabled: true, last_used_at: null },
    { id: 2, name: "无浏览", url: "https://ex2.com", json: JSON.stringify({ bookSourceUrl: "https://ex2.com", bookSourceName: "无浏览" }), enabled: true, last_used_at: null },
  ]);
  const onOpenExplore = vi.fn();
  render(<DiscoverPage onBack={() => {}} onOpenBook={() => {}} onOpenExplore={onOpenExplore} />);
  await screen.findByPlaceholderText("搜索书名与正文");
  // 等 listBookSources 完成
  expect(await screen.findByText(/浏览 有浏览/)).toBeInTheDocument();
  expect(screen.queryByText(/浏览 无浏览/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByText(/浏览 有浏览/));
  expect(onOpenExplore).toHaveBeenCalledWith(1, "有浏览");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx`
Expected: FAIL（无浏览入口）。

- [ ] **Step 3: 实现 DiscoverPage + App**

`DiscoverPage.tsx`：
- 增加 `onOpenExplore?: (sourceId: number, sourceName: string) => void` prop。
- 用 `useEffect` 加载已启用书源并解析 `exploreUrl`（`parseBookSourceJson`），有 exploreUrl 的存到 `exploreSources` state。
- 在搜索框下方渲染浏览入口：
```tsx
{exploreSources.length > 0 && onOpenExplore && (
  <div className="explore-entry">
    {exploreSources.map((s) => (
      <button key={s.id} className="btn btn-ghost" onClick={() => onOpenExplore(s.id, s.name)}>浏览 {s.name}</button>
    ))}
  </div>
)}
```

`App.tsx`：
- View 增加 `| { name: "explore"; sourceId: number; sourceName: string }`。
- discover 分支传 `onOpenExplore={(id, name) => setView({ name: "explore", sourceId: id, sourceName: name })}`。
- explore 分支渲染 `ExplorePage`，`onBack={() => setView({ name: "discover" })}`，`onOpenBook={(hit) => setView({ name: "sourceBook", hit })}`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx` + `npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/pages/DiscoverPage.tsx src/App.tsx src/pages/DiscoverPage.test.tsx
git commit -m "feat: 发现页浏览入口与路由"
```

---

## 已知限制（记录于 spec 附录）

- exploreUrl 内嵌 `@js:` 分类 URL 依赖现有 evalJs（已支持多语句）。
- 图片/漫画书源探索结果暂不渲染图片（子项目 3）。
