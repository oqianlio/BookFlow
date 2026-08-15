# 阅读体验 R20（A2）：护眼定时 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页护眼定时：时间段自动切夜间，窗口外恢复手动模式。

**Architecture:** eyeCare.ts（load/save/isInNightWindow）+ eyeCareWatcher.ts（定时检查）+ SettingsPage 分组 + main.tsx 启动。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## 任务

- [x] Task 1: eyeCare.ts（EyeCareSettings/load/save/isInNightWindow）+ eyeCare.test.ts（4 用例）
- [x] Task 2: eyeCareWatcher.ts（startEyeCareWatcher：窗口内切 dark、窗口外恢复 manualMode）
- [x] Task 3: main.tsx 启动 watcher（60s）
- [x] Task 4: SettingsPage 护眼定时分组（开关 + time inputs）+ toggleMode 记录 manualMode
- [x] Task 5: App.css time-range 样式
- [x] Task 6: SettingsPage.test.tsx 适配（mock eyeCare）+ 新增用例
- [x] Task 7: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [x] isInNightWindow 常规/跨午夜/同时间 ✓
- [x] watcher 窗口内切 dark、窗口外恢复 ✓
- [x] SettingsPage 开关 + 时间输入 + manualMode 记录 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
