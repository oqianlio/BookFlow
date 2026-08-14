# 页面布局优化 批 B 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一细节页标题层级、优化首页统计布局与标题、打磨侧边栏交互、改进 SearchPanel 间距与空态。

**Architecture:** 纯 CSS（App.css h1/统计 grid/side-nav/search-panel）+ 少量 JSX（HomePage 标题、ExplorePage 类名、SearchPanel 空态）。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 不改功能逻辑。
- 现有测试保持绿：`npm test`（当前 222），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/App.css` | 3.1-3.4 CSS | 修改 |
| `src/pages/HomePage.tsx` | 加 概览/快捷操作 标题 | 修改 |
| `src/pages/ExplorePage.tsx` | 根 div 加 explore 类 | 修改 |
| `src/components/SearchPanel.tsx` | 空态/计数 | 修改 |
| `src/pages/HomePage.test.tsx` | 标题断言 | 修改 |

## 任务依赖

单任务（全部改动一起落地）。

---

### Task 1: 布局批 B

**Files:**
- Modify: `src/App.css`
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/pages/ExplorePage.tsx`
- Modify: `src/components/SearchPanel.tsx`
- Test: `src/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes: 无新接口。
- Produces: 无新接口（仅样式/文案）。

- [ ] **Step 1: 更新测试（先红）**

`src/pages/HomePage.test.tsx` 追加：

```tsx
it("renders 概览 and 快捷操作 section headings", async () => {
  vi.mocked(api.listBooks).mockResolvedValue(books);
  render(<HomePage />);
  expect(await screen.findByText("概览")).toBeInTheDocument();
  expect(screen.getByText("快捷操作")).toBeInTheDocument();
});
```

注意：现有测试断言 `screen.getByText("3")`（藏书统计）等——加了标题不影响。若 `概览`/`快捷操作` 与现有断言冲突（不会），调整。

`src/components/SearchPanel.test.tsx`（若有）追加：

```tsx
it("shows 无搜索结果 after a search with no hits", async () => {
  vi.mocked(api.invoke).mockResolvedValue([]);
  render(<SearchPanel onJump={() => {}} />);
  await userEvent.type(screen.getByLabelText("搜索关键词"), "不存在");
  await userEvent.click(screen.getByRole("button", { name: /搜索/ }));
  expect(await screen.findByText(/无搜索结果/)).toBeInTheDocument();
});
```

（若 SearchPanel 无测试文件，可跳过此步或新建——以现有测试文件为准。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/HomePage.test.tsx src/components/SearchPanel.test.tsx`
Expected: FAIL（无标题/无空态）

- [ ] **Step 3: App.css 改动**

**3.1 细节页 h1**（App.css 在 `.source-book .brand h1` 附近，line 1003）：

```css
.explore .brand h1,
.source-manager .brand h1 { font-size: 20px; }
.source-book .brand h1 { font-size: 20px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

**3.2 首页统计 grid + 标题**（App.css:1109）：

```css
.home-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; padding: 0 0 8px; }
.stat-card { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px 12px; background: var(--surface-container-lowest); border: 1px solid var(--outline-variant); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); transition: background-color 0.25s ease, border-color 0.25s ease; }
.home-section { margin: 20px 0 12px; font-family: var(--font-read); font-size: 18px; color: var(--on-surface); }
.home-quick { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 0 24px; }
```

**3.3 SideNav**（App.css:1067/1078）：

```css
.side-nav { width: 96px; flex-shrink: 0; display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 16px 10px; background: var(--surface-container-low); border-right: 1px solid var(--outline-variant); }
.side-nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border: none; border-radius: var(--radius-md); background: transparent; color: var(--on-surface-variant); font-size: 12px; font-weight: 600; cursor: pointer; transition: background-color 0.18s ease, color 0.18s ease; }
```

**3.4 SearchPanel**（App.css:676）：

```css
.search-panel { max-width: 720px; margin: 8px auto 12px; padding: 18px 22px; background: var(--surface-container-lowest); border: 1px solid var(--outline-variant); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }
```

- [ ] **Step 4: HomePage 加标题**

`src/pages/HomePage.tsx`：在 `.home-stats` 前加 `<h2 className="home-section">概览</h2>`，在 `.home-quick` 前加 `<h2 className="home-section">快捷操作</h2>`：

```tsx
      {books.length === 0 ? (
        <div className="empty">
          <h2>书架空空如也</h2>
          <p>去书架页导入书籍，开始你的阅读之旅。</p>
        </div>
      ) : (
        <>
          <h2 className="home-section">概览</h2>
          <div className="home-stats">
            ...
          </div>
        </>
      )}
      <h2 className="home-section">快捷操作</h2>
      <div className="home-quick">
        ...
      </div>
```

（空态时不显示概览标题，快捷操作标题始终显示。）

- [ ] **Step 5: ExplorePage 根 div 加 explore 类**

`src/pages/ExplorePage.tsx` line 68：

```tsx
    <div className="discover explore page">
```

- [ ] **Step 6: SearchPanel 空态/计数**

`src/components/SearchPanel.tsx` 结果区（line 31-39）：

```tsx
      {query.trim() && !busy && results.length === 0 ? (
        <p className="panel-empty">无搜索结果</p>
      ) : (
        <>
          {results.length > 0 && <p className="panel-empty search-count">共 {results.length} 条</p>}
          <ul>
            {results.map((h, i) => (
              <li key={`${h.book_id}-${i}`}>
                <p className="hit-title" onClick={() => onJump(h)}>{h.title}</p>
                <p className="hit-text">{h.text}</p>
              </li>
            ))}
          </ul>
        </>
      )}
```

`App.css` 加 `.search-count`（左对齐，非居中）：

```css
.search-panel .search-count { text-align: left; padding: 12px 0 4px; color: var(--on-surface-variant); font-size: 12.5px; }
```

- [ ] **Step 7: 运行测试 + 构建**

Run: `npx vitest run src/pages/HomePage.test.tsx src/pages/ExplorePage.test.tsx src/components/SearchPanel.test.tsx src/App.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 8: 终审清单**

- [ ] 细节页 h1（explore/source-manager/source-book）20px + source-book 省略号 ✓
- [ ] 首页统计 grid + 概览/快捷操作 标题 ✓
- [ ] SideNav gap 8px + radius-md + 字体 600 恒重 ✓
- [ ] SearchPanel margin 12px + 空态/计数 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 布局批 B 终审修复`）。

- [ ] **Step 9: Commit**

```bash
git add src/App.css src/pages/HomePage.tsx src/pages/ExplorePage.tsx src/components/SearchPanel.tsx src/pages/HomePage.test.tsx
git commit -m "style: 布局批 B 细节页/首页/侧边栏/SearchPanel"
```

---
