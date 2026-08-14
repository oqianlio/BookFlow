# 页面布局优化 批 B：细节页/首页/侧边栏/SearchPanel

日期：2026-08-14
状态：已批准（三批策略确认，批 B 第二）
前置：批 A 完成（空态/panel-empty/分段/输入框/死 CSS）。

## 1. 目标

统一细节页标题层级、优化首页统计布局与标题、打磨侧边栏交互、改进 SearchPanel 间距与空态。

## 2. 非目标

- 不做批 C（探索页列宽、书源管理页细节、SourceBookPage 封面）——后续。
- 不改功能逻辑。

## 3. 改动项

### 3.1 细节页 h1 统一 20px

- 现状：`.source-book .brand h1`（App.css:1003）与 `.debug-source .library-header h1`（App.css:1021）已是 20px；ExplorePage 与书源管理页（`.source-manager`）无覆盖，仍是 26px。
- 新增：
  ```css
  .explore .brand h1,
  .source-manager .brand h1 { font-size: 20px; }
  ```
  （ExplorePage 根 div 是 `discover page`——需加 `explore` 类或改用 `.discover.explore-page`；书源管理页根是 `.source-manager page`。）
  - ExplorePage.tsx 根 div `className="discover page"` → `className="discover explore page"`（保留 discover 复用样式，加 explore 供 h1 覆盖）。
- `.source-book .brand h1` 加省略号防长标题换行：
  ```css
  .source-book .brand h1 { font-size: 20px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ```

### 3.2 首页统计 grid + 标题

- `.home-stats`（App.css:1109）flex-wrap → grid：
  ```css
  .home-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; padding: 20px 0 8px; }
  .stat-card { min-width: 0; }  /* 覆盖原 flex min-width */
  ```
- 复活 `.home-section`（现 App.css:1126，`margin: 8px 0 0` 无 JSX 用）：
  - HomePage.tsx 在 `.home-stats` 前加 `<h2 className="home-section">概览</h2>`，在 `.home-quick` 前加 `<h2 className="home-section">快捷操作</h2>`。
  - `.home-section { margin: 20px 0 12px; font-family: var(--font-read); font-size: 18px; color: var(--on-surface); }`
  - `.home-stats` padding 改为 `0 0 8px`（标题已提供顶部空间）。

### 3.3 SideNav

- `.side-nav`（App.css:1067）gap `4px` → `8px`。
- `.side-nav-item`（App.css:1078）border-radius `12px` → `var(--radius-md)`。
- active 字体抖动：所有 item `font-weight: 600`（active 不再变 400→600）：
  ```css
  .side-nav-item { ... font-weight: 600; }
  .side-nav-item.active { font-weight: 600; }  /* 已一致，可省 */
  ```
  或设固定 label 宽度。**倾向**：所有 item 恒 600，active 仅靠 `secondary-container` 背景区分。

### 3.4 SearchPanel

- `.search-panel`（App.css:676）margin `8px auto 28px` → `8px auto 12px`。
- 无结果空态：SearchPanel.tsx 在结果 `<ul>` 为空且已搜索时显示 `<p className="panel-empty">无搜索结果</p>`；有结果时显示 `<p className="panel-empty">共 N 条</p>`（或 `.search-count` 类，`text-align:left`）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/App.css` | 3.1-3.4 CSS |
| `src/pages/HomePage.tsx` | 加 概览/快捷操作 标题 |
| `src/pages/ExplorePage.tsx` | 根 div 加 explore 类 |
| `src/components/SearchPanel.tsx` | 空态/计数 |
| `src/pages/HomePage.test.tsx` | 标题断言（如影响） |

## 5. 测试

- HomePage：渲染 概览/快捷操作 标题。
- SearchPanel：无结果提示、计数。
- ExplorePage：根类加 explore 不影响现有测试。
- 现有测试保持绿（222）。

## 6. 错误处理

- 无新错误路径。
