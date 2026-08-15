# 探索页左右分栏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ExplorePage 左右分栏：左分类导航 + 右书籍列表。

**Architecture:** 渲染改 `.explore-layout` 两栏；样式替换 `.explore-cats`；逻辑不变。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 逻辑（loadCategory/分页/错误处理）不变，仅布局。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；不修改 `docs/` 与 `.git/`。

---

## 任务

- [x] Task 1: ExplorePage 渲染改左右分栏（side 分类 + main 列表）
- [x] Task 2: App.css 样式（explore-layout/side/main/cat-item）
- [x] Task 3: 测试——新增布局与激活态用例；现有用例文本断言不受影响
- [x] Task 4: 全量 `npm test`（332 通过）、`npm run build` 通过、提交

## 终审清单

- [x] 分类在左侧栏（竖排、sticky、独立滚动）✓
- [x] 书籍列表在右侧（点击分类刷新、分页）✓
- [x] 激活态高亮 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
