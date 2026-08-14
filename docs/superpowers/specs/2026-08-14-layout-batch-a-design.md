# 页面布局优化 批 A：Bug 修复 + 跨页一致性

日期：2026-08-14
状态：已批准（用户确认三批各一计划，批 A 先行）
前置：已完成书源管理独立页、界面动效、分组折叠。

## 1. 目标

修复明显布局 bug 并统一跨页面一致性问题。本批聚焦：空态间距、panel-empty 统一、主题分段控件溢出、输入框样式统一、死 CSS 清理。

## 2. 非目标

- 不做批 B（细节页 h1/首页统计/侧边栏/SearchPanel）与批 C（探索/书源管理细化）——后续计划。
- 不改功能逻辑。

## 3. 改动项

### 3.1 空态间距（`.empty`，App.css:659）

- 现 `.empty { display:flex; flex-direction:column; align-items:center; }` 无 gap，图标（LibraryPage BookIcon 56px / HomePage）与 h2 间距为 0。
- 改：
  ```css
  .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .empty h2 { margin: 0; }
  .empty p { margin: 0; }
  ```
- 影响：LibraryPage + HomePage 空态。

### 3.2 统一 `.panel-empty`（App.css:979/1046/1101 + ReaderPage.css:310）

- 现状 3 处不同 padding（48px/48px/24px）+ ReaderPage.css 用坏 token（`--fg-muted` 仅 reader 作用域有）。
- 新增全局规则（App.css 合适位置）：
  ```css
  .panel-empty { text-align: center; color: var(--on-surface-variant); padding: 48px 0; font-size: 13.5px; }
  ```
- 删除三处 scoped 重复：`.discover .panel-empty`（App.css:979）、`.source-toc .panel-empty`（App.css:1046）、`.debug-source .panel-empty`（App.css:1101）。
- 删除 ReaderPage.css 的全局 `.panel-empty`（line ~310，若它设了 color: var(--fg-muted)）。
- 影响：所有页面空态/加载态统一居中 muted。

### 3.3 主题分段控件溢出（`.segmented button`，App.css:862）

- 5 个方案按钮（Sora/Koharu/Yuuka/Phoebe/WH）总宽约 400px，超出 `.settings-group` 可用宽度，溢出卡片。
- 改：
  ```css
  .segmented { display: flex; }
  .segmented button { flex: 1; white-space: nowrap; padding: 6px 10px; }
  ```
  （`.my .settings-group .segmented` 随卡片宽度拉伸，5 按钮均分。）
- 保留 `.segmented button.active` 样式。

### 3.4 输入框样式统一

- 现 5 种输入框不同背景/padding：`.search-panel .panel-add input`（high/9px 14px）、`.discover-search input`（low/11px 16px）、`.source-filter`（low/10px 14px）、`.source-import-row input`（surface/10px 14px）、`.debug-input-row input`（high/10px 14px）。
- 统一为：`background: var(--surface-container-low); padding: 10px 14px; border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); color: var(--on-surface); font-size: 13px; font-family: var(--font-ui);`
- 应用：逐处更新上述 5 个选择器的 background/padding（保留各自的 focus/placeholder 规则）。

### 3.5 清理死 CSS

删除未被组件引用的规则：
- `.page-head`（App.css:349）
- `.page-actions`（App.css:377）
- `.empty-icon`（App.css:669）
- `.settings`（App.css:819）
- `.settings-form`（App.css:823）
- 重复的 `.btn-primary` 块（App.css:446-473 的旧块，保留较新的一个）
- `.home .book-grid`（App.css:1168）

删除前确认：用 grep 验证类名无 JSX 引用。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/App.css` | 上述 3.1-3.5 改动 |
| `src/pages/ReaderPage.css` | 删除坏 `.panel-empty` 全局规则 |

## 5. 测试

- 无逻辑改动，现有测试保持绿（222）。
- 视觉验证：书架/首页空态、书源管理空态、设置页主题分段、各输入框。
- 若删除死 CSS 影响测试断言（如 `settings-form` 被某测试查），以运行为准修正。

## 6. 错误处理

- 无新错误路径。
