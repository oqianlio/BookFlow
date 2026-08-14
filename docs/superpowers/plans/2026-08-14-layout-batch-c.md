# 页面布局优化 批 C 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化探索页列宽统一、书源管理页层级细节、SourceBookPage 渲染封面与目录标题。

**Architecture:** App.css 列宽/层级 CSS + BookSourceManager 导入标题 + SourceBookPage 封面渲染（info.coverUrl 已提取）。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 不改功能逻辑。
- 现有测试保持绿：`npm test`（当前 224），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/App.css` | 3.1-3.3 CSS | 修改 |
| `src/components/BookSourceManager.tsx` | 导入标题 | 修改 |
| `src/pages/SourceBookPage.tsx` | 封面渲染 + 目录标题 | 修改 |
| `src/pages/SourceBookPage.test.tsx` | 封面/标题测试 | 修改 |

## 任务依赖

单任务（全部改动一起落地）。

---

### Task 1: 布局批 C

**Files:**
- Modify: `src/App.css`
- Modify: `src/components/BookSourceManager.tsx`
- Modify: `src/pages/SourceBookPage.tsx`
- Test: `src/pages/SourceBookPage.test.tsx`

**Interfaces:**
- Consumes: SourceBookPage `info.coverUrl`（已有）。
- Produces: 无新接口。

- [ ] **Step 1: 写失败测试（追加到 SourceBookPage.test.tsx）**

```tsx
const coverSourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text", coverUrl: ".cover img@src" },
  ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href", nextTocUrl: "" },
});

it("renders cover image when ruleBookInfo provides coverUrl", async () => {
  vi.mocked(api.httpGet).mockResolvedValue(
    `<html><body><h1>三体</h1><div class="cover"><img src="https://cdn.com/c.jpg"></div><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
  );
  vi.mocked(api.listBookSources).mockResolvedValue([
    { id: 1, name: "示例", url: "https://ex.com", json: coverSourceJson, enabled: true, last_used_at: null },
  ]);
  render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
  expect(await screen.findByText("三体")).toBeInTheDocument();
  const img = document.querySelector("img.source-book-cover") as HTMLImageElement | null;
  expect(img).not.toBeNull();
  expect(img!.getAttribute("src")).toBe("https://cdn.com/c.jpg");
  expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx`
Expected: FAIL（无封面 img / 无目录标题）

- [ ] **Step 3: App.css 改动**

**3.1 探索页列宽**（App.css:906/935/943）：

```css
.discover-search { display: flex; gap: 10px; max-width: 720px; margin: 20px 0 24px; }
.explore-entry { display: flex; flex-wrap: wrap; gap: 10px; max-width: 720px; margin: 0 0 24px; }
.discover-results { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
```

**3.2 书源管理页层级**（App.css:878/879/903）：

```css
.source-import { border-top: 1px solid var(--outline-variant); padding-top: 16px; margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
.source-import-title { margin: 0 0 0; font-size: 13px; color: var(--on-surface-variant); }
.source-group-head { display: flex; align-items: center; gap: 8px; padding: 12px 10px; cursor: pointer; user-select: none; font-size: 13px; font-weight: 600; color: var(--primary); border-radius: var(--radius-sm); transition: background-color 0.18s ease; }
.source-group-head:hover { background: var(--surface-container-high); }
.source-list li { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 16px; background: var(--surface-container-lowest); border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); margin-bottom: 12px; transition: background-color 0.25s ease, border-color 0.25s ease; }
```

**3.3 SourceBookPage 封面**（App.css:1043 附近）：

```css
.source-book-info { display: flex; gap: 16px; max-width: 720px; margin: 18px auto 24px; }
.source-book-cover { width: 110px; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-container-high); flex-shrink: 0; }
.source-book-cover-ph { width: 110px; aspect-ratio: 3/4; border-radius: var(--radius-sm); background: var(--surface-container-high); flex-shrink: 0; }
.source-book-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.source-book-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--on-surface); }
```

- [ ] **Step 4: BookSourceManager 导入标题**

`src/components/BookSourceManager.tsx` 在 `.source-import` 前加标题：

```tsx
      <h3 className="source-import-title">导入书源</h3>
      <div className="source-import">
        <button className="btn btn-ghost" onClick={() => void handleFileImport()}>从文件导入</button>
        ...
      </div>
```

- [ ] **Step 5: SourceBookPage 封面渲染 + 目录标题**

`src/pages/SourceBookPage.tsx` 的 `.source-book-info` 与 `.source-toc`：

```tsx
      <div className="source-book-info">
        {info.coverUrl ? (
          <img
            className="source-book-cover"
            src={info.coverUrl}
            alt={info.title || "封面"}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="source-book-cover-ph" aria-hidden />
        )}
        <div className="source-book-meta">
          <h2 className="source-book-title">{info.title || sourceName}</h2>
          {info.author && <span className="hit-author">{info.author}</span>}
          {info.intro && <p className="source-intro">{info.intro}</p>}
          <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
        </div>
      </div>
      <div className="source-toc">
        <h2 className="home-section">目录</h2>
        {toc.length === 0 ? (
          <p className="panel-empty">暂无目录</p>
        ) : (
          ...
        )}
      </div>
```

注意：`coverUrl` 已是绝对 URL（引擎 resolve），直接 `<img src>`。原 `.source-book-info` 是文本列（source-name/author/intro/button），改造后 `sourceName` 由 `.source-book-title` 展示（`info.title || sourceName`）。

- [ ] **Step 6: 运行测试 + 构建**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx src/components/BookSourceManager.test.tsx src/pages/DiscoverPage.test.tsx src/pages/ExplorePage.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 7: 终审清单**

- [ ] 探索页 search/results/entry 列宽统一 720px 左对齐 ✓
- [ ] 书源管理组标题 hover + 导入分隔线标题 + 行背景提亮 ✓
- [ ] SourceBookPage 封面 img/占位 + 目录标题 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 布局批 C 终审修复`）。

- [ ] **Step 8: Commit**

```bash
git add src/App.css src/components/BookSourceManager.tsx src/pages/SourceBookPage.tsx src/pages/SourceBookPage.test.tsx
git commit -m "style: 布局批 C 探索列宽/书源管理层级/书籍页封面"
```

---
