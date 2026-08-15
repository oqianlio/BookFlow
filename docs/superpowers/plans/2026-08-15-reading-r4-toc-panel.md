# 阅读体验 R4：阅读页目录面板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 书源阅读页顶栏新增「目录」入口，弹出右侧目录面板：全书章节列表、当前章节高亮、点击跳转章节；目录抓取逻辑提取为共享服务（sourceToc.ts），书籍页与阅读页共用。

**Architecture:** 新建 `src/services/sourceToc.ts`（fetchToc + 内存缓存）；SourceBookPage 改用 fetchToc（行为不变）；ReaderPage 加目录按钮 + 面板 + jumpToChapter。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 仅书源书接入目录面板；本地书（EPUB 自带目录/PDF 页导航）不动。
- 不做目录搜索、多书源目录合并、目录持久化（会话内缓存即可）。
- 现有测试保持绿：`npm test`、`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/sourceToc.ts` | fetchToc 共享服务 + 缓存 | 新建 |
| `src/services/sourceToc.test.ts` | 缓存/抓取/失败测试 | 新建 |
| `src/pages/SourceBookPage.tsx` | 改用 fetchToc，删除内联逻辑 | 修改 |
| `src/pages/ReaderPage.tsx` | 目录按钮 + 面板 + jumpToChapter | 修改 |
| `src/pages/ReaderPage.css` | 目录面板/高亮样式 | 修改 |
| `src/pages/ReaderPage.source.test.tsx` | 目录面板测试 | 修改 |
| `src/pages/SourceBookPage.test.tsx` | 适配（行为不变） | 修改 |

## 任务依赖

Task 1（sourceToc 服务）→ Task 2（SourceBookPage 适配）→ Task 3（ReaderPage 目录面板）→ Task 4（测试/终审）。

---

### Task 1: sourceToc 共享服务

**Files:**
- Create: `src/services/sourceToc.ts`
- Test: `src/services/sourceToc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TocItem { name: string; url: string }
  export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }
  export async function fetchToc(opts: {
    sourceId: number;
    bookUrl: string;
    initialTitle: string;
  }): Promise<{ info: SourceBookInfo; toc: TocItem[] }>;
  export function clearTocCache(): void;
  ```

- [ ] **Step 1: 写失败测试**

`src/services/sourceToc.test.ts`（mock `./api` 的 listBookSources/httpGet）：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { fetchToc, clearTocCache } from "./sourceToc";

vi.mock("./api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href" },
});

const bookHtml = `<html><body><h1>三体</h1><span class="author">刘慈欣</span><ol>
  <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;

beforeEach(() => { vi.clearAllMocks(); clearTocCache(); });

describe("fetchToc", () => {
  it("fetches book info and toc list", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    const r = await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(r.info.title).toBe("三体");
    expect(r.info.author).toBe("刘慈欣");
    expect(r.toc.map((t) => t.name)).toEqual(["第一章", "第二章"]);
    expect(r.toc[0].url).toBe("https://ex.com/c/1.html"); // 相对 URL 已解析
  });

  it("caches the result per source+book and does not re-request", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(api.httpGet).toHaveBeenCalledTimes(1);
  });

  it("uses a separate cache entry for a different book", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/2.html", initialTitle: "球状闪电" });
    expect(api.httpGet).toHaveBeenCalledTimes(2);
  });

  it("throws when the source is missing", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    await expect(fetchToc({ sourceId: 99, bookUrl: "https://ex.com/b.html", initialTitle: "x" }))
      .rejects.toThrow("书源不存在");
  });

  it("throws when httpGet fails and does not cache the failure", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockRejectedValueOnce(new Error("网络错误")).mockResolvedValueOnce(bookHtml);
    await expect(fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" }))
      .rejects.toThrow("网络错误");
    // 失败不缓存：重试成功
    const r = await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(r.toc.length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/sourceToc.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 sourceToc.ts**

把 SourceBookPage 的抓取逻辑原样提取（含 resolveUrl / cookieJar / parseHtml / extractSingle / extractList），注意 `resolveUrl` 已在 bookSourceEngine 导出（确认导出名，无则用 `new URL` 兜底——现 SourceBookPage 用的是 `new URL(u, base)` 逻辑，保持一致）：

```ts
import { listBookSources, httpGet, mergeUserAgent } from "./api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, type BookSource } from "./bookSourceEngine";

export interface TocItem { name: string; url: string }
export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }

const cache = new Map<string, Promise<{ info: SourceBookInfo; toc: TocItem[] }>>();

export function clearTocCache(): void {
  cache.clear();
}

export async function fetchToc(opts: {
  sourceId: number;
  bookUrl: string;
  initialTitle: string;
}): Promise<{ info: SourceBookInfo; toc: TocItem[] }> {
  const key = `${opts.sourceId}:${opts.bookUrl}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = doFetch(opts);
  cache.set(key, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(key);  // 失败不缓存
    throw e;
  }
}

async function doFetch(opts: { sourceId: number; bookUrl: string; initialTitle: string }) {
  const bs = (await listBookSources()).find((x) => x.id === opts.sourceId);
  if (!bs) throw new Error("书源不存在");
  const s: BookSource = parseBookSourceJson(bs.json);
  if (!opts.bookUrl) throw new Error("书籍地址无效，无法打开");
  const base = s.bookSourceUrl || opts.bookUrl;
  const resolvedBookUrl = opts.bookUrl.startsWith("http") ? opts.bookUrl : new URL(opts.bookUrl, base).toString();
  let cookieJarHost = "";
  try { cookieJarHost = new URL(s.bookSourceUrl).hostname; } catch { cookieJarHost = s.bookSourceUrl; }
  const html = await httpGet(resolvedBookUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const bi = s.ruleBookInfo ?? {};
  const title = bi.name ? await extractSingle(doc, bi.name, { result: html, sourceKey: s.bookSourceUrl }) : opts.initialTitle;
  const author = bi.author ? await extractSingle(doc, bi.author, { result: html, sourceKey: s.bookSourceUrl }) : "";
  const intro = bi.intro ? await extractSingle(doc, bi.intro, { result: html, sourceKey: s.bookSourceUrl }) : "";
  const cover = bi.coverUrl ? await extractSingle(doc, bi.coverUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl }) : "";
  const tocUrl = bi.tocUrl ? await extractSingle(doc, bi.tocUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl }) : resolvedBookUrl;
  const tocHtml = tocUrl === resolvedBookUrl ? html : await httpGet(tocUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const tocDoc = parseHtml(tocHtml);
  const rules = s.ruleToc ?? {};
  const items = await extractList(tocDoc, rules.chapterList ?? "", {
    name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
  }, { baseUrl: tocUrl, result: tocHtml, sourceKey: s.bookSourceUrl });
  const toc = items.filter((i) => i.url).map((i) => ({
    name: i.name || "未命名章节",
    url: i.url.startsWith("http") ? i.url : new URL(i.url, tocUrl).toString(),
  }));
  return { info: { title: title || opts.initialTitle, author, intro, coverUrl: cover }, toc };
}
```

（与 SourceBookPage 现有逻辑逐行对照，行为保持一致。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/sourceToc.test.ts`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sourceToc.ts src/services/sourceToc.test.ts
git commit -m "feat: 共享目录抓取服务（sourceToc）"
```

---

### Task 2: SourceBookPage 适配

**Files:**
- Modify: `src/pages/SourceBookPage.tsx`

- [ ] **Step 1: 改用 fetchToc**

- import：`import { fetchToc, type TocItem } from "../services/sourceToc";`
- 删除内联抓取（httpGet/parseHtml/extractSingle/extractList/mergeUserAgent 相关逻辑与 imports）。
- 初始化 effect 改为：

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const r = await fetchToc({ sourceId, bookUrl, initialTitle });
      if (!cancelled) {
        setInfo(r.info);
        setToc(r.toc);
      }
    } catch (e) {
      if (!cancelled) showError(String(e));
    }
  })();
  return () => { cancelled = true; };
}, [sourceId, bookUrl, initialTitle]);
```

- `source` state 与登录按钮逻辑保留（SourceBookPage 仍需要 source.loginUrl → 需从 listBookSources 取。保留现有 `setSource` 获取，或 fetchToc 内取不到 loginUrl。**注意**：SourceBookPage 的登录按钮依赖 `source.loginUrl`，fetchToc 不返回书源 JSON。方案：保留一段轻量代码取书源（仅 `listBookSources().find` + `parseBookSourceJson` 取 loginUrl），或让 fetchToc 额外返回 `loginUrl`。**选后者更干净**：fetchToc 返回值加 `loginUrl?: string`，SourceBookPage 从 r 取。）

更新 sourceToc.ts：

```ts
export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }
// fetchToc 返回 { info, toc, loginUrl? }
```

```ts
return { info: { title: title || opts.initialTitle, author, intro, coverUrl: cover }, toc, loginUrl: s.loginUrl };
```

同步更新 sourceToc.test.ts 断言（返回对象多 loginUrl 字段不影响现有断言，若用 toEqual 需检查——现有断言用字段访问，安全）。

- [ ] **Step 2: 运行确认通过**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx`
Expected: 现有 7 用例保持绿（行为不变）

- [ ] **Step 3: Commit**

```bash
git add src/services/sourceToc.ts src/pages/SourceBookPage.tsx src/services/sourceToc.test.ts
git commit -m "refactor: SourceBookPage 改用共享 fetchToc"
```

---

### Task 3: ReaderPage 目录面板

**Files:**
- Modify: `src/pages/ReaderPage.tsx`
- Modify: `src/pages/ReaderPage.css`
- Test: `src/pages/ReaderPage.source.test.tsx`

**Interfaces:**
- Consumes: `fetchToc/TocItem` from `../services/sourceToc`。
- Produces: 无新接口。

- [ ] **Step 1: 状态与预取**

```tsx
import { fetchToc, type TocItem } from "../services/sourceToc";

// panel 类型扩展
const [panel, setPanel] = useState<"annotations" | "bookmarks" | "settings" | "toc" | null>(null);

// 目录状态（仅书源）
const [toc, setToc] = useState<TocItem[]>([]);
const [tocLoading, setTocLoading] = useState(false);
const [tocFailed, setTocFailed] = useState(false);
const tocSeqRef = useRef(0);

const loadToc = useCallback(async (force = false) => {
  if (isLocal) return;
  setTocLoading(true); setTocFailed(false);
  const seq = ++tocSeqRef.current;
  try {
    const r = await fetchToc({ sourceId, bookUrl, initialTitle: bookTitle });
    if (seq !== tocSeqRef.current) return;
    setToc(r.toc);
  } catch {
    if (seq !== tocSeqRef.current) return;
    setTocFailed(true);
  } finally {
    if (seq === tocSeqRef.current) setTocLoading(false);
  }
}, [isLocal, sourceId, bookUrl, bookTitle]);

// 进入时预取（打开面板即有数据）
useEffect(() => {
  if (!isLocal) void loadToc();
}, [isLocal, loadToc]);
```

注意：`loadToc(force)` 的重试需要清缓存——fetchToc 失败不缓存，所以重试直接再调即可；`force` 参数可留作未来扩展（本批不实现强制刷新按钮，仅失败重试）。

- [ ] **Step 2: 顶栏目录按钮（书源分支，设置按钮旁）**

```tsx
<button
  className={`btn-icon${panel === "toc" ? " active" : ""}`}
  onClick={() => setPanel((p) => (p === "toc" ? null : "toc"))}
  aria-label="目录"
  title="目录"
>
  <TocIcon size={17} />
</button>
```

`icons.tsx` 新增 `TocIcon`（列表图标：三行横线，风格与现有一致）：

```tsx
export function TocIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M8 6h.01M8 12h.01M8 18h.01" />
    </svg>
  );
}
```

- [ ] **Step 3: 面板渲染（reader-body 内，settings 面板旁）**

```tsx
{!isLocal && panel === "toc" && (
  <div className="panel reader-toc-panel">
    <h3>目录</h3>
    {tocLoading && toc.length === 0 && <p className="panel-empty">加载中…</p>}
    {tocFailed && toc.length === 0 && (
      <div className="panel-empty">
        <p>目录加载失败</p>
        <button className="btn btn-primary" onClick={() => void loadToc()}>重试</button>
      </div>
    )}
    {!tocLoading && !tocFailed && toc.length === 0 && <p className="panel-empty">暂无目录</p>}
    {toc.length > 0 && (
      <ol className="toc-list">
        {toc.map((t, idx) => (
          <li key={`${t.url}-${idx}`}>
            <button
              type="button"
              className={`toc-item${chapter.index === idx || chapter.url === t.url ? " active" : ""}`}
              onClick={() => jumpToChapter(idx, t.url, t.name)}
            >
              {t.name}
            </button>
          </li>
        ))}
      </ol>
    )}
  </div>
)}
```

- [ ] **Step 4: jumpToChapter**

```tsx
const jumpToChapter = useCallback((idx: number, url: string, name: string) => {
  prevUrlsRef.current = [];   // 从目录跳转后上一章从该章节往前
  nextUrlRef.current = "";
  setChapter({ index: idx, url, name });
  setPanel(null);
}, []);
```

- [ ] **Step 5: 样式（ReaderPage.css）**

```css
/* ============ 目录面板 ============ */
.reader-toc-panel .toc-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.reader-toc-panel .toc-item {
  display: block; width: 100%; text-align: left; padding: 8px 12px;
  border: none; background: transparent; color: var(--fg);
  border-radius: var(--radius-sm); font-size: 13.5px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.reader-toc-panel .toc-item:hover { background: var(--surface); }
.reader-toc-panel .toc-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
```

- [ ] **Step 6: 测试（ReaderPage.source.test.tsx 追加）**

```tsx
describe("ReaderPage (source) toc panel", () => {
  async function renderWithToc(saved: Record<string, string> = {}) {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") {
        return `<html><body><div id="content"><p>第一章正文内容。</p></div>
          <a id="next" href="/c/2.html">下一章</a></body></html>`;
      }
      return `<html><body><h1>三体</h1><ol>
        <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;
    });
    const utils = renderReader();
    await screen.findByText("第一章正文内容。");
    return utils;
  }

  it("opens the toc panel and lists chapters with current highlighted", async () => {
    const { container } = await renderWithToc();
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(container.querySelector(".reader-toc-panel")).not.toBeNull();
    const items = container.querySelectorAll(".toc-item");
    expect(items.length).toBe(2);
    expect(items[0].className).toContain("active");
    expect(items[0].textContent).toBe("第一章");
  });

  it("jumps to a chapter from the toc", async () => {
    const { container } = await renderWithToc();
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    const items = container.querySelectorAll(".toc-item");
    await userEvent.click(items[1] as HTMLElement);
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(container.querySelector(".reader-toc-panel")).toBeNull();  // 面板已关闭
    // 高亮移动到第二章
  });

  it("shows retry on toc failure and recovers", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    // 第一次正文成功；目录抓取第一次失败
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") return `<html><body><div id="content"><p>第一章正文内容。</p></div></body></html>`;
      throw new Error("目录网络错误");
    });
    renderReader();
    await screen.findByText("第一章正文内容。");
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(await screen.findByText("目录加载失败")).toBeInTheDocument();
    // 恢复后重试成功
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") return `<html><body><div id="content"><p>第一章正文内容。</p></div></body></html>`;
      return `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`;
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("第一章")).toBeInTheDocument();
  });
});
```

注意测试中正文 URL 与目录 URL 不同（bookUrl vs tocUrl），mock 需按 URL 分支。现有测试 `httpGet` 只 mock 章节 URL；目录预取会额外请求 bookUrl——**现有 source 测试的 httpGet.mockResolvedValue(ch1) 会被目录请求复用同一响应**（同一 mock 返回 ch1），目录解析失败会静默（tocFailed，不影响正文断言）。为不破坏现有测试，目录预取的失败路径设计为**静默**（不 showError，仅面板内显示失败）——已在 loadToc 中 catch 不抛错。确认现有测试的正文断言不受目录请求影响。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run src/pages/ReaderPage.source.test.tsx src/pages/SourceBookPage.test.tsx src/services/sourceToc.test.ts`
Expected: 全绿

- [ ] **Step 8: Commit**

```bash
git add src/pages/ReaderPage.tsx src/pages/ReaderPage.css src/components/icons.tsx src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 书源阅读页目录面板（跳转章节）"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿（含新增 sourceToc 5、ReaderPage 目录面板用例）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] `sourceToc.ts` 共享服务 + 5 测试 ✓
- [ ] SourceBookPage 改用 fetchToc，登录按钮仍工作（loginUrl 从 fetchToc 返回）✓
- [ ] ReaderPage 目录按钮/面板/跳转/高亮/失败重试 ✓
- [ ] 本地书（EPUB/PDF/MD/TXT）未改动 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 目录面板终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 目录面板终审修复"
```

---
