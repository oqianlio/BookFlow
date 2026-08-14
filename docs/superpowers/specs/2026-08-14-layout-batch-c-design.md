# 页面布局优化 批 C：探索/书源管理/SourceBookPage

日期：2026-08-14
状态：已批准（三批策略确认，批 C 第三）
前置：批 A、批 B 完成。

## 1. 目标

优化探索页列宽统一、书源管理页层级细节、SourceBookPage 渲染封面与目录标题。

## 2. 非目标

- 不改功能逻辑。
- 不做书源编辑页。

## 3. 改动项

### 3.1 探索页列宽统一（DiscoverPage/ExplorePage 共用 .discover-search/.discover-results/.hit-card）

现状：header 左对齐 26px h1；`.discover-search` 居中 720px；`.discover-results` 全宽（~916px）——一页三种列宽；`.explore-entry` 有负 margin hack。

改：
- `.discover-search`（App.css:906）：`margin: 20px auto 28px` → `margin: 20px 0 24px`（左对齐 header）。
- `.discover-results`（App.css:943）：加 `max-width: 720px;`（与搜索同宽，左对齐）。
- `.explore-entry`（App.css:935）：`margin: -8px auto 24px` → `margin: 0 0 24px`（去掉负 margin hack）。
- `.hit-card`（App.css:949）保持（在 720px 列内）。

注意：ExplorePage 根 div 现为 `discover explore page`，其 `.discover-results` 也受上述改动影响——一致化。

### 3.2 书源管理页层级细节（BookSourceManager）

- `.source-group-head`（App.css:879）：加 hover 背景 + 圆角：
  ```css
  .source-group-head { ... padding: 12px 10px; border-radius: var(--radius-sm); transition: background-color 0.18s ease; }
  .source-group-head:hover { background: var(--surface-container-high); }
  ```
- `.source-import`（App.css:878）：加分隔线 + 顶部标题：
  ```css
  .source-import { border-top: 1px solid var(--outline-variant); padding-top: 16px; margin-top: 16px; }
  ```
  BookSourceManager.tsx 在 `.source-import` 前加 `<h3 className="source-import-title">导入书源</h3>`，样式 `.source-import-title { font-size: 13px; color: var(--on-surface-variant); margin: 16px 0 8px; }`。
- `.source-list li`（App.css:878 附近）：背景 `var(--surface)` → `var(--surface-container-lowest)`（与 hit-card 一致，提亮行）。

### 3.3 SourceBookPage 封面 + 目录标题

- 渲染封面：`.source-book-info` 改为横向布局，左侧 3:4 封面缩略图（~110px 宽），右侧文本：
  ```tsx
  <div className="source-book-info">
    {info.coverUrl ? (
      <img className="source-book-cover" src={info.coverUrl} alt={info.title || "封面"} />
    ) : (
      <div className="source-book-cover source-book-cover-ph" aria-hidden />
    )}
    <div className="source-book-meta">
      <h2 className="source-book-title">{info.title || sourceName}</h2>
      {info.author && <span className="hit-author">{info.author}</span>}
      {info.intro && <p className="source-intro">{info.intro}</p>}
      <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
    </div>
  </div>
  ```
  `coverUrl` 已在 info state（SourceBookPage.tsx:55）。`coverUrl` 是绝对 URL（引擎已 resolve），直接用 `<img src>`。
  - 样式：
    ```css
    .source-book-info { display: flex; gap: 16px; max-width: 720px; margin: 18px auto 24px; }
    .source-book-cover { width: 110px; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-container-high); flex-shrink: 0; }
    .source-book-cover-ph { background: var(--surface-container-high); }
    .source-book-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .source-book-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--on-surface); }
    ```
- 目录标题：`.source-toc` 前加 `<h2 className="home-section">目录</h2>`（复用批 B 的 `.home-section`），显示章节数可选（`共 {toc.length} 章`）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/App.css` | 3.1-3.3 CSS |
| `src/pages/DiscoverPage.tsx` | 无（仅 CSS） |
| `src/components/BookSourceManager.tsx` | 导入标题 |
| `src/pages/SourceBookPage.tsx` | 封面渲染 + 目录标题 |
| `src/pages/SourceBookPage.test.tsx` | 封面/标题断言（如影响） |

## 5. 测试

- SourceBookPage：有 coverUrl 渲染 img；无 coverUrl 渲染占位；目录标题「目录」出现。
- 现有 Discover/Explore/SourceBook/BookSourceManager 测试保持绿（224）。

## 6. 错误处理

- 封面加载失败：`<img onError>` 隐藏或显示占位——**倾向**：img 加 `onError={(e) => (e.currentTarget.style.display = "none")}` 兜底。
- 无新错误路径。
