# 阅读体验 R22（A5）：字体文件加载 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入本地字体文件（ttf/otf/woff2）注册为阅读字体，导入后自动设为当前阅读字体。

**Architecture:** Rust `copy_font_file`/`list_font_files` 命令（复制到 fonts/ 目录）；`fontFiles.ts` 注入 @font-face（asset 协议）；SettingsPage 字体文件分组；main.tsx 启动注入。

**Tech Stack:** Rust + React 19 + TypeScript + vitest。

## Global Constraints

- assetProtocol scope 加 `$APPDATA/fonts/**`。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。
- Shell 为 PowerShell 7；不修改 `docs/` 与 `.git/`。

---

## 任务

- [x] Task 1: Rust copy_font_file/list_font_files + 注册 + tauri.conf scope
- [x] Task 2: api.ts 封装 + fontFiles.ts（injectFontFaces）
- [x] Task 3: SettingsPage 字体文件分组（导入→注册→设当前字体）
- [x] Task 4: main.tsx 启动注入已导入字体
- [x] Task 5: 测试（SettingsPage 导入流程、App.test mock 适配）
- [x] Task 6: 全量 `npm test`（343）、`npm run build`、提交

## 终审清单

- [x] copy_font_file 复制到 fonts/、list 列出 ✓
- [x] @font-face 注入（asset 协议）✓
- [x] 导入后自动设为阅读字体 ✓
- [x] 测试全绿、构建通过、工作树干净 ✓
