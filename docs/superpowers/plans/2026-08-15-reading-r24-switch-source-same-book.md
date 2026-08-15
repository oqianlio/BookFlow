# 阅读体验 R24（换源保持同一本书）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复换源后「显示的不是同一本书」：换源搜索带作者精确匹配；换源后保持原书书名。

**Architecture:** ReaderPage 记录 author（fetchToc 的 info.author）并传给 SwitchSourcePanel；App 换源跳转时用原 bookTitle 覆盖 hit.title。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 现有测试保持绿：`npm test`、`npm run build`。
- 换源流程（详情页确认）不变。

---

## 任务

- [x] Task 1: ReaderPage 记录 author（fetchToc 的 info.author）并传给换源面板
- [x] Task 2: App.tsx 换源跳转保持原书书名（覆盖 hit.title）
- [x] Task 3: SourceBookPage 详情页书名固定 initialTitle（不被源解析杂质书名覆盖）
- [x] Task 4: SwitchSourcePanel 候选列表书名统一显示确认书名（阅读页换源界面）
- [x] Task 5: App 层统一换源入口 switchSource（阅读页/详情页行为一致，书名均以当前所读书名为准）
- [x] Task 6: 换源候选列表按 sourceId 去重（书名匹配度评分：完全一致 > 互相包含 > 其他，取最高分）
- [x] Task 7: 测试（换源面板 author props、详情页书名保持、候选列表书名统一、同源去重、精确匹配优先）
- [x] Task 8: 全量 `npm test`、`npm run build`、提交

## 终审清单

- [x] 阅读页换源按「书名 + 作者」搜索 ✓
- [x] 换源候选列表书名显示确认书名（非源解析杂质名）✓
- [x] 换源后详情页书名与原书一致 ✓
- [x] 阅读页与详情页两个换源入口行为统一 ✓
- [x] 同一书源只保留一个候选，且为书名匹配度最高的 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
