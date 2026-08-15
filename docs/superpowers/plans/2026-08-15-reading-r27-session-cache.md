# 阅读体验 R27（会话级章节缓存）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 换源/重开刚看过的书零加载直接显示。

**Architecture:** 模块级会话缓存替代 ReaderPage 组件内 ref 缓存。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- ReaderPage.source.test 需在 beforeEach 清会话缓存（模块级状态共享）。

---

## 任务

- [x] Task 1: chapterSessionCache 模块（get/set/clear，上限 30 淘汰最旧）
- [x] Task 2: ReaderPage 改用会话缓存（loadChapter/applyCachedChapter/prefetchChapter）
- [x] Task 3: 会话命中分支补 setLoading(false)（跨卸载重开不再卡「加载中…」）
- [x] Task 4: 测试（缓存模块单测 + 重开零加载集成用例 + 既有用例清缓存适配）
- [x] Task 5: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [x] 刚看过的章节重开零加载（无网络请求、无「加载中…」）✓
- [x] 漫画章节同样会话缓存 ✓
- [x] 缓存上限 30 条自动淘汰 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
