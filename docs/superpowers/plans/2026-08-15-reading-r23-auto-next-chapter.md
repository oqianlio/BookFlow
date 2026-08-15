# 阅读体验 R23（页尾自动下一章）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复「翻页到章节末页/漫画最后一张图后，无法自动进入下一章/下一话」的体验 bug。非自动播放（A1 不做）。

**Architecture:** `PaginatedReader`/`MangaViewer` 新增 `onReachEnd` 回调；`ReaderPage` 接入 `goChapter(1)`。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- 初始上报不触发 onReachEnd（单页章节不跳章）。

---

## 任务

- [ ] Task 1: PaginatedReader 新增 onReachEnd（go() 触达末页时调用）
- [ ] Task 2: MangaViewer 新增 onReachEnd（IntersectionObserver 监听末图）
- [ ] Task 3: ReaderPage 接入（文字章节 + 漫画 → goChapter(1)）
- [ ] Task 4: 测试（PaginatedReader/MangaViewer/ReaderPage.source）
- [ ] Task 5: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [ ] 翻到文字章节末页自动进入下一章 ✓
- [ ] 漫画最后一张图进入视口自动进入下一话 ✓
- [ ] 无 nextContentUrl 时静默不跳 ✓
- [ ] 测试全绿、构建通过、工作树干净 ✓
