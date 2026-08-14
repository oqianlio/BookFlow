# 界面视觉/交互全面优化设计文档

日期：2026-08-14
状态：已批准
前置：已完成 MD3 界面、错误弹窗、首页仪表盘、书源功能等。

## 1. 目标

全面优化应用界面视觉与交互：加入页面切换过渡、加载反馈（spinner）、弹窗/面板动效、主题切换过渡；统一全局间距；细化各功能页面布局，消除拥挤感。

## 2. 非目标

- 不改动阅读页（ReaderPage/ReaderPage.css 纸张主题独立）。
- 不引入动画库（纯 CSS）。
- 不改变功能逻辑（仅视觉/交互）。

## 3. 动效层

### 3.1 页面切换过渡

- `@keyframes page-in`：`opacity 0→1; transform translateY(8px)→0`，200ms ease。
- App.tsx 主区：`<main className="app-main">` 内，给当前渲染的页面容器（`.page`/`.home`/`.library` 等）加过渡——**实现方式**：App.tsx 对主区渲染设 `key={state.area}`（或对 main 内 wrapper 设 key），配合 CSS `.app-main > * { animation: page-in 0.2s ease; }`。
- 详情页进入同样生效（key 变化触发）。

### 3.2 加载反馈

- `@keyframes spin`（旋转）。
- `.spinner`：28px 圆环，`border: 3px solid var(--outline-variant); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;`。
- `.loading-state`（spinner + 文案水平排列）。
- 替换：ExplorePage:81 与 SourceReaderPage:145 的纯文字「加载中…」为 `<span className="loading-state"><span className="spinner" /><span>加载中…</span></span>`。

### 3.3 弹窗/面板动效

- `@keyframes dialog-in`：`opacity 0→1; transform scale(0.96)→1`，160ms ease。
- `.error-dialog`、`.import-confirm` 加 `animation: dialog-in 0.16s ease;`。

### 3.4 主题切换过渡

- body 已有 `transition: background-color 0.25s, color 0.25s`。
- 补充过渡到卡片/列表/导航类：`.stat-card`、`.hit-card`、`.source-list li`、`.settings-group`、`.side-nav-item`、`.book-card` 加 `transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;`（与现有 hover transform 过渡合并保留）。

## 4. 间距统一

### 4.1 全局页面

- `.page` padding `0 28px 56px` → `0 32px 64px`。
- `.app-main .page` 同步（max-width 980px 保留）。

### 4.2 卡片类统一

| 类 | 现 | 新 |
|---|---|---|
| `.hit-card` | padding 14px 18px | padding 16px 20px, gap 14px→16px |
| `.source-list li` | padding 10px 14px, gap 12px, mb 8px | padding 14px 16px, gap 16px, mb 12px |
| `.source-actions` | gap 8px | gap 10px |
| `.settings-group` | padding 14px 18px | padding 16px 20px |
| `.book-grid` | gap 26px 20px | gap 24px 20px |
| `.discover-results` | gap 10px | gap 12px |
| `.source-toc li` | (border radius-sm) | padding 略增, radius-md |

### 4.3 书源管理（用户指出拥挤）

- `.source-list li` 按上表放宽。
- `.source-import` gap 10px → 12px。
- `.source-import-row input` padding 8px 12px → 10px 14px。

## 5. 各页面布局细化

### 5.1 发现页
- `.hit-card` 间距放宽（见 4.2）。
- `.discover-search input` 高度略增（padding 10px 14px → 11px 16px）。
- `.explore-entry` gap 8px → 10px。

### 5.2 书架
- `.book-grid` gap 调整（见 4.2）。
- `.library-header` padding `28px 0 8px` → `28px 0 16px`（标题下方透气）。
- `.empty` padding 80px→72px 顶部。

### 5.3 我的页
- `.my-form` gap 14px → 16px。
- `.settings-group` 内 label/hint 间距加 `gap: 4px`（label 与 hint 之间）。

### 5.4 调试器
- `.debug-controls` margin `16px auto 24px` 保留；`.debug-field` padding 8px 12px → 10px 14px。
- `.debug-html pre` 保留。

### 5.5 首页
- `.home-stats` gap 12px → 14px。
- `.home-quick` gap 10px → 12px。

## 6. 文件修改

| 文件 | 动作 |
|---|---|
| `src/App.css` | keyframes/spinner/loading-state/dialog-in + 间距/过渡调整 |
| `src/App.tsx` | 主区 key={state.area} 触发页面过渡 |
| `src/pages/ExplorePage.tsx` | 加载态换 spinner |
| `src/pages/SourceReaderPage.tsx` | 加载态换 spinner |
| 各页面 CSS 类引用处 | 由 App.css 统一调整（TSX 一般不改，除非类结构调整） |

## 7. 测试

- 无逻辑改动，现有测试保持绿（217）。
- 若 App.tsx key 改动影响 App.test，更新断言。
- 视觉验证：启动应用人工检查各页过渡/间距/加载态。

## 8. 错误处理

- 无新错误路径。动画失败不影响功能（纯视觉）。
