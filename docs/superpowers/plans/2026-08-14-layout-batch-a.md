# 页面布局优化 批 A 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复明显布局 bug（空态间距、主题分段溢出、panel-empty 统一、输入框统一）并清理死 CSS。

**Architecture:** 纯 CSS 改动（App.css + ReaderPage.css 删除坏规则）；先 grep 确认死类无引用再删除。

**Tech Stack:** CSS + vitest（jsdom）。无新依赖。

## Global Constraints

- 只改 CSS，不改 JSX/逻辑（除非删除死类影响测试）。
- 现有测试保持绿：`npm test`（当前 222），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/App.css` | 3.1-3.5 改动 | 修改 |
| `src/pages/ReaderPage.css` | 删除坏 `.panel-empty`（line 310-313） | 修改 |

## 任务依赖

单任务（全部 CSS 改动一起落地）。

---

### Task 1: 布局批 A CSS 改动

**Files:**
- Modify: `src/App.css`
- Modify: `src/pages/ReaderPage.css`
- Test: 无新增（纯 CSS，构建验证）

**Interfaces:**
- Produces: 无新接口（仅样式）。

- [ ] **Step 1: 空态间距（App.css:659）**

`.empty` 加 `gap: 8px`；`.empty h2` margin `0 0 6px` → `0`；`.empty p` margin `0 0 24px` → `0`：

```css
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  padding: 80px 20px 60px;
  color: var(--on-surface-variant);
}
.empty h2 {
  margin: 0;
  font-family: var(--font-read);
  font-size: 18px;
  font-weight: 600;
  color: var(--on-surface);
}
.empty p {
  margin: 0;
  font-size: 13.5px;
  max-width: 340px;
}
```

- [ ] **Step 2: 统一 panel-empty（App.css + ReaderPage.css）**

在 App.css 通用区（如 `.error` 附近）新增全局规则：

```css
.panel-empty { text-align: center; color: var(--on-surface-variant); padding: 48px 0; font-size: 13.5px; }
```

删除 App.css 三处 scoped 重复：
- `.discover .panel-empty`（line 979）
- `.source-toc .panel-empty`（line 1046）
- `.debug-source .panel-empty`（line 1101）

删除 ReaderPage.css line 310-313 的全局 `.panel-empty`：

```css
/* 删除整块：
.panel-empty {
  color: var(--fg-muted);
  font-size: 13px;
}
*/
```

- [ ] **Step 3: 主题分段控件（App.css:853/862）**

```css
.segmented {
  display: flex;
  background: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-sm);
  padding: 3px;
  gap: 2px;
}
.segmented button {
  flex: 1;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--on-surface-variant);
  transition: background-color 0.18s ease, color 0.18s ease;
}
.segmented button.active {
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  box-shadow: var(--shadow-sm);
}
```

- [ ] **Step 4: 输入框统一（5 处）**

逐处把 `background` 设为 `var(--surface-container-low)`、`padding` 设为 `10px 14px`：

| 选择器 | 现 background | 现 padding |
|---|---|---|
| `.search-panel .panel-add input`（line 721） | `--surface-container-high` | `9px 14px` |
| `.discover-search input`（line 943） | `--surface-container-low` | `11px 16px` |
| `.source-filter`（line 918） | `--surface-container-low` | `10px 14px` |
| `.source-import-row input`（line 922） | `--surface` | `10px 14px` |
| `.debug-input-row input`（line 1066） | `--surface-container-high` | `10px 14px` |

统一值：`background: var(--surface-container-low); padding: 10px 14px;`（其余属性如 border/radius/color/font 保持现有）。保留各 input 的 focus/placeholder 规则。

- [ ] **Step 5: 清理死 CSS**

删除（grep 已确认无 JSX 引用）：
- `.page-head`（App.css:349-354）
- `.page-actions`（App.css:377-381）
- `.empty-icon`（App.css:669-674）
- `.settings`（App.css:819-822）
- `.settings-form`（App.css:823-829）
- `.home .book-grid`（App.css:1168）
- 重复 `.btn-primary` 块：App.css 有两个 `.btn-primary`（~line 419 与 ~line 470）。**保留一个**（保留属性更完整的那个），删除另一个。删除前确认两块的差异——保留含 `color: var(--on-primary)` + `filter: brightness` 的那份（Task 2 界面优化修复过的）。用 `git log -p src/App.css | grep -n "btn-primary"` 或读文件确认哪个是最终版，删除冗余的旧块。

注意：删除前对每个类 `grep -rn "className=\"[^\"]*<类名>"` 确认零引用（本计划已确认 page-head/page-actions/empty-icon/settings-form/home-section 为 0；`.settings` 裸类也 0——SettingsPage 用 `.my page`；`.home .book-grid` 0——首页已无 book-grid）。

- [ ] **Step 6: 构建 + 测试**

Run: `npm run build` 通过；`npm test` 222 绿。
若某测试断言依赖被删的类/样式（不太可能，CSS 不驱动断言），以运行为准修正。

- [ ] **Step 7: 终审清单**

- [ ] `.empty` 空态间距 gap 8px ✓
- [ ] 全局 `.panel-empty` 单规则，3 处 scoped 已删 ✓
- [ ] ReaderPage.css 坏 `.panel-empty` 已删 ✓
- [ ] 主题分段按钮 flex:1 不再溢出 ✓
- [ ] 5 个输入框 background/padding 统一 ✓
- [ ] 7 处死 CSS 已删（.btn-primary 只留一份）✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 布局批 A 终审修复`）。

- [ ] **Step 8: Commit**

```bash
git add src/App.css src/pages/ReaderPage.css
git commit -m "style: 布局批 A 修复与跨页一致性"
```

---
