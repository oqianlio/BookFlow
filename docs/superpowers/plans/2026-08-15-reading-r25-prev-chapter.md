# 阅读体验 R25（章节首页向前翻页进入上一章）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 章节第一页继续向前翻页进入上一章节（历史栈优先，目录兜底）。

**Architecture:** PaginatedReader 新增 `onReachStart`；ReaderPage `goChapter(-1)` 增加目录兜底。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- 初始渲染不触发 onReachStart（避免单页章节加载即跳上一章）。

---

## 任务

- [x] Task 1: PaginatedReader 新增 onReachStart（首页越过时调用，方向语义：向前翻越过首页）
- [x] Task 2: ReaderPage goChapter(-1) 目录兜底 + 接入 onReachStart
- [x] Task 3: 底部「上一章/下一章」按钮 disabled 条件适配（栈空但目录有章时可点）
- [x] Task 4: 测试（PaginatedReader onReachStart 方向语义 / ReaderPage 首页翻页进上一章）
- [x] Task 5: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [x] 章节首页点击左侧自动进入上一章 ✓
- [x] 无历史栈时目录兜底进入上一章 ✓
- [x] 第一章无上一章时静默 ✓
- [x] 翻回首页不误触发上一章 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
