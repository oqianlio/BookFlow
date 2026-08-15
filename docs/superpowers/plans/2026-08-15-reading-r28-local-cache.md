# 阅读体验 R28（本地书缓存 + 书源列表缓存）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本地书重开零读盘；书源列表高频调用不再重复 IPC。

**Architecture:** `localBookCache.ts` 模块级文本缓存 + `api.ts` listBookSources 10s 短缓存。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- 本地阅读器测试需在 beforeEach 清缓存（模块级状态共享）。

---

## 任务

- [x] Task 1: localBookCache 模块（readLocalText，上限 5 淘汰最旧）+ 单测
- [x] Task 2: TxtReader/MdReader 改用 readLocalText（测试加 clearLocalTextCache）
- [x] Task 3: api.ts listBookSources 10s TTL 缓存 + CRUD 失效
- [x] Task 4: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [x] 本地 TXT/MD 会话内重开零读盘 ✓
- [x] 书源列表 10s 缓存 + 变更即时失效 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
