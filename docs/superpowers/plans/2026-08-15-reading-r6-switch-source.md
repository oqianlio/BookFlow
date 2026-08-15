# 阅读体验 R6：换源（多书源切换） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一本书可在多个书源间切换。抽取共享搜索服务，新增换源面板，书籍详情页与阅读页提供换源入口。

**Architecture:** `src/services/searchService.ts`（searchBookSources，抽自 DiscoverPage）；`src/components/SwitchSourcePanel.tsx`（自动搜索 + 候选列表）；SourceBookPage/ReaderPage 入口 + App 路由。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖、无 Rust 改动。

## Global Constraints

- 换源后进入新书详情页（SourceBookPage），由用户选章阅读；不做跨源章节 URL 映射。
- 进度按 (source_id, book_url) 独立保存（现有机制），换源不迁移进度。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/searchService.ts` | searchBookSources 共享服务 | 新建 |
| `src/services/searchService.test.ts` | 搜索/过滤/降级测试 | 新建 |
| `src/pages/DiscoverPage.tsx` | 改用共享服务 | 修改 |
| `src/components/SwitchSourcePanel.tsx` | 换源面板 | 新建 |
| `src/components/SwitchSourcePanel.test.tsx` | 面板测试 | 新建 |
| `src/pages/SourceBookPage.tsx` | 换源按钮 + 面板 | 修改 |
| `src/pages/ReaderPage.tsx` | 换源按钮 + 面板 | 修改 |
| `src/App.tsx` | onSwitchSource 路由 | 修改 |

## 任务依赖

Task 1（searchService）→ Task 2（DiscoverPage 适配）→ Task 3（SwitchSourcePanel）→ Task 4（入口与路由）→ Task 5（验证）。

---

### Task 1: searchService 共享服务

**Files:**
- Create: `src/services/searchService.ts`
- Test: `src/services/searchService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SearchHit {
    title: string; author: string; coverUrl: string; bookUrl: string;
    sourceId: number; sourceName: string;
  }
  export async function searchBookSources(query: string, opts?: {
    sourceIds?: number[];
  }): Promise<SearchHit[]>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import * as api from "./api";
import { searchBookSources } from "./searchService";

vi.mock("./api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

const srcJson = (name: string) => JSON.stringify({
  bookSourceUrl: `https://${name}.com`, bookSourceName: name,
  searchUrl: `https://${name}.com/search?q={{key}}`,
  ruleSearch: { bookList: "ul>li", name: "h3@text", author: "p@text", bookUrl: "a@href" },
});

const hitHtml = (title: string, author: string, href: string) =>
  `<html><body><ul><li><h3>${title}</h3><p>${author}</p><a href="${href}">链接</a></li></ul></body></html>`;

describe("searchBookSources", () => {
  it("searches across all enabled sources and aggregates hits", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) =>
      url.startsWith("https://a.com")
        ? hitHtml("三体", "刘慈欣", "/a/1.html")
        : hitHtml("三体", "刘慈欣", "/b/2.html"),
    );
    const hits = await searchBookSources("三体");
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.sourceName).sort()).toEqual(["源A", "源B"]);
    expect(hits[0].bookUrl).toMatch(/^https?:\/\//);
  });

  it("filters to the given sourceIds (exclude current source)", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(hitHtml("三体", "刘慈欣", "/x/1.html"));
    const hits = await searchBookSources("三体", { sourceIds: [2] });
    expect(api.httpGet).toHaveBeenCalledTimes(1);
    expect(hits[0].sourceName).toBe("源B");
  });

  it("degrades gracefully when a single source fails", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url.startsWith("https://a.com")) throw new Error("网络错误");
      return hitHtml("三体", "刘慈欣", "/b/2.html");
    });
    const hits = await searchBookSources("三体");
    expect(hits.length).toBe(1);
    expect(hits[0].sourceName).toBe("源B");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/searchService.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 searchService.ts**

从 DiscoverPage 提取 `searchSource` 逻辑：

```ts
import { httpGet, listBookSources, mergeUserAgent, type BookSource as ApiBookSource } from "./api";
import { parseHtml, parseBookSourceJson, resolveSearchUrl, extractBookList, type BookSource as Src } from "./bookSourceEngine";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: ApiBookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1, { sourceKey: src.bookSourceUrl });
  if (!parsed.url) return [];
  let cookieJarHost = "";
  try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
  const html = await httpGet(parsed.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, parsed.method, parsed.body, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  const items = await extractBookList(doc, rules, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl });
  return items.filter((i) => i.name).map((i) => ({
    title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
    bookUrl: i.bookUrl ?? "", sourceId: bs.id, sourceName: bs.name,
  }));
}

export async function searchBookSources(query: string, opts?: { sourceIds?: number[] }): Promise<SearchHit[]> {
  const sources = (await listBookSources()).filter((s) => s.enabled);
  const targets = opts?.sourceIds ? sources.filter((s) => opts.sourceIds!.includes(s.id)) : sources;
  const all = await Promise.all(targets.map((s) => searchSource(query.trim(), s).catch(() => [] as SearchHit[])));
  return all.flat();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/searchService.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/searchService.ts src/services/searchService.test.ts
git commit -m "feat: 共享多书源搜索服务（searchService）"
```

---

### Task 2: DiscoverPage 改用共享服务

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`
- Test: `src/pages/DiscoverPage.test.tsx`

- [ ] **Step 1: 替换 searchSource**

- 删除组件内 `searchSource` 函数与相关 imports（httpGet/mergeUserAgent/parseHtml/parseBookSourceJson/resolveSearchUrl/extractBookList）。
- 引入 `import { searchBookSources } from "../services/searchService";`。
- `run()` 改为：

```tsx
const run = async () => {
  if (!query.trim()) return;
  setBusy(true);
  try {
    setHits(await searchBookSources(query));
  } catch (e) {
    showError(String(e));
  } finally {
    setBusy(false);
  }
};
```

- `SearchHit` 类型改为从 searchService 导入（`export type { SearchHit }` 保持 DiscoverPage 对外导出兼容 ExplorePage 的引用——检查 ExplorePage 是否 import 了 DiscoverPage 的 SearchHit）。

注意：ExplorePage 有 `import type { SearchHit } from "./DiscoverPage"`（见 ExplorePage.tsx L5）。保持 DiscoverPage 重新导出：`export type { SearchHit } from "../services/searchService";`。

- [ ] **Step 2: 适配测试**

- DiscoverPage.test.tsx 现有 mock httpGet/listBookSources 的用例需改为 mock `searchService` 模块（或保留 api mock 由 searchService 内部使用）。**选后者更稳**：searchService 内部调 api，测试只需保证 api mock 不变即可——但 DiscoverPage 不再直接 import api 函数，检查测试是否 spy 了 `api.httpGet`。若 spy 的是 api 模块函数，searchService 也 import 同一 api 模块，vi.mock 仍生效。
- 运行确认。

- [ ] **Step 3: Commit**

```bash
git add src/pages/DiscoverPage.tsx src/pages/DiscoverPage.test.tsx
git commit -m "refactor: DiscoverPage 改用共享搜索服务"
```

---

### Task 3: SwitchSourcePanel 组件

**Files:**
- Create: `src/components/SwitchSourcePanel.tsx`
- Test: `src/components/SwitchSourcePanel.test.tsx`

**Interfaces:**
- Consumes: `searchBookSources/SearchHit`。
- Produces:
  ```tsx
  export default function SwitchSourcePanel({ title, author, excludeSourceId, onPick, onClose }: {
    title: string; author: string; excludeSourceId: number;
    onPick: (hit: SearchHit) => void; onClose: () => void;
  });
  ```

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SwitchSourcePanel from "./SwitchSourcePanel";
import * as searchService from "../services/searchService";

vi.mock("../services/searchService", () => ({ searchBookSources: vi.fn() }));

const hits = [
  { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://b.com/1.html", sourceId: 2, sourceName: "源B" },
  { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://c.com/1.html", sourceId: 3, sourceName: "源C" },
];

describe("SwitchSourcePanel", () => {
  it("searches with title+author excluding the current source", () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue(hits);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    expect(searchService.searchBookSources).toHaveBeenCalledWith("三体 刘慈欣", { sourceIds: [2, 3] });
  });

  it("renders candidates and calls onPick on click", async () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue(hits);
    const onPick = vi.fn();
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={onPick} onClose={() => {}} />);
    expect(await screen.findByText("源B")).toBeInTheDocument();
    fireEvent.click(screen.getByText("源B"));
    expect(onPick).toHaveBeenCalledWith(hits[0]);
  });

  it("shows empty state when no candidates found", async () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue([]);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/未在其它书源找到/)).toBeInTheDocument();
  });

  it("shows failure state with retry", async () => {
    vi.mocked(searchService.searchBookSources)
      .mockRejectedValueOnce(new Error("网络错误"))
      .mockResolvedValueOnce(hits);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/搜索失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("源B")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/SwitchSourcePanel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

```tsx
import { useEffect, useState } from "react";
import { searchBookSources, type SearchHit } from "../services/searchService";

export default function SwitchSourcePanel({ title, author, excludeSourceId, onPick, onClose }: {
  title: string; author: string; excludeSourceId: number;
  onPick: (hit: SearchHit) => void; onClose: () => void;
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);

  const run = async () => {
    setBusy(true); setFailed(false);
    const seq = ++seqRef.current;
    try {
      const sources = (await import("../services/api")).listBookSources;
      const all = await sources().then((l) => l.filter((s) => s.enabled));
      const targets = all.filter((s) => s.id !== excludeSourceId).map((s) => s.id);
      const h = await searchBookSources(`${title} ${author}`.trim(), { sourceIds: targets });
      if (seq !== seqRef.current) return;
      setHits(h);
    } catch {
      if (seq !== seqRef.current) return;
      setFailed(true);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  useEffect(() => { void run(); }, []);

  return (
    <div className="panel switch-source-panel">
      <h3>换源：{title}</h3>
      {busy && hits.length === 0 && <p className="panel-empty">搜索中…</p>}
      {failed && (
        <div className="panel-empty">
          <p>搜索失败</p>
          <button className="btn btn-primary" onClick={() => void run()}>重试</button>
        </div>
      )}
      {!busy && !failed && hits.length === 0 && <p className="panel-empty">未在其它书源找到该书</p>}
      {hits.length > 0 && (
        <div className="switch-source-list">
          {hits.map((h, i) => (
            <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onPick(h)}>
              <div className="hit-info">
                <span className="hit-title">{h.title}</span>
                <span className="hit-author">{h.author}</span>
              </div>
              <span className="hit-source">{h.sourceName}</span>
            </div>
          ))}
        </div>
      )}
      <div className="panel-actions">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
```

注意：面板内联获取启用书源列表再传 sourceIds，避免把「排除当前源」逻辑耦合进 searchService（searchService 只做过滤给定集合）。测试里 mock searchBookSources 断言调用参数——参数包含 targets（动态获取），测试需 mock `../services/api` 的 listBookSources。调整测试 Step 1 中第一个用例为同时 mock api.listBookSources 并断言 `sourceIds` 等于排除后的列表。以实际运行为准。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/SwitchSourcePanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/SwitchSourcePanel.tsx src/components/SwitchSourcePanel.test.tsx
git commit -m "feat: 换源面板组件"
```

---

### Task 4: 入口与路由

**Files:**
- Modify: `src/pages/SourceBookPage.tsx`
- Modify: `src/pages/ReaderPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: SourceBookPage**

- props 加 `onSwitchSource?: (hit: SearchHit) => void`。
- state `showSwitch`；meta 区「换源」按钮（加入书架旁）：

```tsx
{onSwitchSource && (
  <button className="btn btn-ghost" onClick={() => setShowSwitch(true)}>换源</button>
)}
```

- 面板渲染（与书籍内容同屏右侧或用现有 .panel 机制——SourceBookPage 是独立页，用绝对定位浮层或直接条件渲染在页面内）：

```tsx
{showSwitch && onSwitchSource && (
  <SwitchSourcePanel title={info.title || initialTitle} author={info.author} excludeSourceId={sourceId}
    onPick={(hit) => { setShowSwitch(false); onSwitchSource!(hit); }}
    onClose={() => setShowSwitch(false)} />
)}
```

- 样式：`.switch-source-panel` 浮层（fixed 右侧，复用 panel 外观）。

- [ ] **Step 2: ReaderPage**

- props 加 `onSwitchSource?: (hit: SearchHit) => void`。
- 顶栏「换源」按钮（加入书架旁），`panel === "switch"` 渲染 SwitchSourcePanel（复用现有 panel 机制，扩展 panel 类型）。

```tsx
{onSwitchSource && (
  <button
    className={`btn-icon${panel === "switch" ? " active" : ""}`}
    onClick={() => setPanel((p) => (p === "switch" ? null : "switch"))}
    aria-label="换源" title="换源"
  >
    <SwitchIcon size={17} />
  </button>
)}
```

- icons.tsx 新增 `SwitchIcon`（交换箭头）。
- `panel` 类型加 `"switch"`。

- [ ] **Step 3: App.tsx 路由**

- `sourceBook` 详情与 `sourceReader` 详情都传：

```tsx
onSwitchSource={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state.back })}
```

（换源后进入新书详情页。）

- [ ] **Step 4: 测试**

- SourceBookPage.test.tsx：mock SwitchSourcePanel（或走真实组件 + mock searchService），断言换源按钮打开面板、onPick 回调。
- ReaderPage.source.test.tsx：同上。
- App.test.tsx 无需改（onSwitchSource 可选 prop）。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx src/pages/ReaderPage.source.test.tsx src/App.test.tsx`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/pages/SourceBookPage.tsx src/pages/ReaderPage.tsx src/App.tsx src/components/icons.tsx
git commit -m "feat: 书籍详情与阅读页换源入口"
```

---

### Task 5: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 searchService 3、SwitchSourcePanel 4 + 入口用例）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] searchService 共享服务 + 3 测试 ✓
- [ ] DiscoverPage 改用共享服务，SearchHit 重新导出（ExplorePage 兼容）✓
- [ ] SwitchSourcePanel + 4 测试 ✓
- [ ] SourceBookPage/ReaderPage 换源入口 + App 路由 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 换源终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 换源终审修复"
```

---
