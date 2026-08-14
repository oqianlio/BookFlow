# 首页仪表盘改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页从「统计 + 最近阅读书卡」改为仪表盘（统计卡 + 3 个快捷入口），消除与书架的功能重复。

**Architecture:** `HomePage` 移除 `recent` 书卡网格与 `onOpenBook` prop，新增 `onGoDiscover` prop 与内部导入逻辑（`importFiles` + 刷新统计）；`App.tsx` 同步接线；App.css 加快捷入口样式。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 首页**不显示任何书籍卡片/列表**（彻底消除与书架重复）。
- 快捷入口为 3 个：导入书籍 / 去书架 / 去发现。全文搜索保留在书架页（不做跨页状态传递）。
- 统计沿用 `computeStats` + `listBooks()`，无新后端命令。
- 现有测试保持绿：`npm test`（当前 217），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/pages/HomePage.tsx` | 仪表盘：统计 + 快捷入口 + 导入 | 修改 |
| `src/pages/HomePage.test.tsx` | 更新测试 | 修改 |
| `src/App.tsx` | HomePage 接线（删 onOpenBook，加 onGoDiscover） | 修改 |
| `src/App.test.tsx` | api mock 加 importFiles | 修改 |
| `src/App.css` | `.home-quick` 样式 | 修改 |

## 任务依赖

单任务（HomePage + App 接线 + 测试 + 样式一起落地）。

---

### Task 1: 首页改仪表盘

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Test: `src/pages/HomePage.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `listBooks`/`importFiles` from `../services/api`；`useError` from `../components/ErrorDialog`；`computeStats`（保留）。
- Produces:
  ```ts
  export default function HomePage({
    onGoBookshelf, onGoDiscover,
  }: {
    onGoBookshelf?: () => void;
    onGoDiscover?: () => void;
  });
  ```
  （`onOpenBook` prop **移除**。）

- [ ] **Step 1: 更新测试（先红）**

`src/pages/HomePage.test.tsx` 改为：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage, { computeStats } from "./HomePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({ listBooks: vi.fn(), importFiles: vi.fn() }));

const now = 1_700_000_000;

const books = [
  { id: 1, title: "三体", format: "epub", path: "a.epub", cover_path: null, added_at: 1, last_opened_at: now - 3600 },
  { id: 2, title: "算法", format: "pdf", path: "b.pdf", cover_path: null, added_at: 2, last_opened_at: now - 10 * 86400 },
  { id: 3, title: "旧书", format: "epub", path: "c.epub", cover_path: null, added_at: 3, last_opened_at: null },
];

describe("computeStats", () => {
  it("counts total, formats, and last-7-day opens", () => {
    const s = computeStats(books, now);
    expect(s.total).toBe(3);
    expect(s.byFormat).toEqual([{ format: "epub", count: 2 }, { format: "pdf", count: 1 }]);
    expect(s.openedLast7).toBe(1);
  });
});

describe("HomePage", () => {
  it("renders stats and quick actions, no book cards", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    render(<HomePage />);
    expect(await screen.findByText("3")).toBeInTheDocument();  // 藏书统计
    expect(screen.getByText("EPUB")).toBeInTheDocument();       // 格式统计
    expect(screen.getByRole("button", { name: /导入书籍/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去书架/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去发现/ })).toBeInTheDocument();
    // 不再渲染最近阅读书卡
    expect(screen.queryByText("三体")).not.toBeInTheDocument();
    expect(screen.queryByText("算法")).not.toBeInTheDocument();
  });

  it("shows empty state when no books", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    render(<HomePage />);
    expect(await screen.findByText(/书架空空/)).toBeInTheDocument();
  });

  it("calls importFiles and refreshes on 导入书籍 click", async () => {
    vi.mocked(api.listBooks).mockResolvedValueOnce([]).mockResolvedValueOnce(books);
    vi.mocked(api.importFiles).mockResolvedValue(books as any);
    render(<HomePage />);
    await screen.findByText(/书架空空/);
    await userEvent.click(screen.getByRole("button", { name: /导入书籍/ }));
    expect(api.importFiles).toHaveBeenCalled();
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("navigates to bookshelf and discover via quick buttons", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    const goShelf = vi.fn();
    const goDiscover = vi.fn();
    render(<HomePage onGoBookshelf={goShelf} onGoDiscover={goDiscover} />);
    await screen.findByText(/书架空空/);
    await userEvent.click(screen.getByRole("button", { name: /去书架/ }));
    expect(goShelf).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /去发现/ }));
    expect(goDiscover).toHaveBeenCalled();
  });
});
```

`src/App.test.tsx` 的 api mock 加 `importFiles`（HomePage 挂载不调用，但 mock 完整性）：

```ts
vi.mock("./services/api", () => ({
  listBookSources: vi.fn().mockResolvedValue([]),
  listBooks: vi.fn().mockResolvedValue([]),
  importFiles: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getTtsRate: vi.fn().mockResolvedValue(1),
}));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/HomePage.test.tsx`
Expected: FAIL（`onOpenBook` 不存在于新 props / 快捷按钮缺失 / 书卡仍渲染）

- [ ] **Step 3: 实现 HomePage**

```tsx
// src/pages/HomePage.tsx
import { useEffect, useState } from "react";
import { listBooks, importFiles, type Book } from "../services/api";
import { useError } from "../components/ErrorDialog";

export interface HomeStats {
  total: number;
  byFormat: Array<{ format: string; count: number }>;
  openedLast7: number;
}

export function computeStats(books: Book[], now: number = Math.floor(Date.now() / 1000)): HomeStats {
  const counts = new Map<string, number>();
  let openedLast7 = 0;
  for (const b of books) {
    counts.set(b.format, (counts.get(b.format) ?? 0) + 1);
    if (b.last_opened_at != null && now - b.last_opened_at <= 7 * 86400) openedLast7 += 1;
  }
  const byFormat = [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count);
  return { total: books.length, byFormat, openedLast7 };
}

export default function HomePage({ onGoBookshelf, onGoDiscover }: {
  onGoBookshelf?: () => void; onGoDiscover?: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBooks();
        if (!cancelled) setBooks(list);
      } catch (e) {
        if (!cancelled) showError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = computeStats(books);

  const handleImport = async () => {
    setBusy(true);
    try {
      await importFiles();
      setBooks(await listBooks());
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home page">
      <header className="library-header">
        <div className="brand"><h1>你好，枕书</h1></div>
      </header>
      {books.length === 0 ? (
        <div className="empty">
          <h2>书架空空如也</h2>
          <p>去书架页导入书籍，开始你的阅读之旅。</p>
          {onGoBookshelf && <button className="btn btn-primary" onClick={onGoBookshelf}>去书架</button>}
        </div>
      ) : (
        <div className="home-stats">
          <div className="stat-card"><span className="stat-value">{stats.total}</span><span className="stat-label">藏书</span></div>
          {stats.byFormat.map((f) => (
            <div className="stat-card" key={f.format}><span className="stat-value">{f.count}</span><span className="stat-label">{f.format.toUpperCase()}</span></div>
          ))}
          <div className="stat-card"><span className="stat-value">{stats.openedLast7}</span><span className="stat-label">近 7 天打开</span></div>
        </div>
      )}
      <div className="home-quick">
        <button className="btn btn-primary" onClick={() => void handleImport()} disabled={busy}>
          {busy ? "导入中…" : "导入书籍"}
        </button>
        {onGoBookshelf && <button className="btn btn-soft" onClick={onGoBookshelf}>去书架</button>}
        {onGoDiscover && <button className="btn btn-soft" onClick={onGoDiscover}>去发现</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 接线 App.tsx**

`src/App.tsx` 的 home 分支：

```tsx
{state.area === "home" && (
  <HomePage
    onGoBookshelf={() => setState({ area: "bookshelf" })}
    onGoDiscover={() => setState({ area: "discover" })}
  />
)}
```

（删除 `onOpenBook` 传参。）

- [ ] **Step 5: 样式（App.css 追加）**

```css
.home-quick { display: flex; flex-wrap: wrap; gap: 10px; padding: 8px 0 24px; }
```

- [ ] **Step 6: 运行测试 + 构建**

Run: `npx vitest run src/pages/HomePage.test.tsx src/App.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 7: 终审清单**

- [ ] 首页无书籍卡片（queryByText 书名断言通过）✓
- [ ] 3 个快捷入口（导入/去书架/去发现）✓
- [ ] `onOpenBook` prop 已从 HomePage 与 App.tsx 移除 ✓
- [ ] 统计卡 + 空态保留 ✓
- [ ] 导入刷新统计 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 首页仪表盘终审修复`）。

- [ ] **Step 8: Commit**

```bash
git add src/pages/HomePage.tsx src/pages/HomePage.test.tsx src/App.tsx src/App.test.tsx src/App.css
git commit -m "feat: 首页改为仪表盘（统计+快捷入口）"
```

---
