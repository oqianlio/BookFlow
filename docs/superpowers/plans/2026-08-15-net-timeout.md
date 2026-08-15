# 网络超时放宽（R26）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 慢站点（如 biquge 系）请求不再频繁超时。

**Architecture:** `src-tauri/src/net.rs` 默认总超时 30s + 连接超时 10s。

**Tech Stack:** Rust（reqwest）。无前端改动。

## Global Constraints

- `cargo test` 保持绿。

---

## 任务

- [x] Task 1: DEFAULT_TIMEOUT_MS 15s → 30s
- [x] Task 2: 新增 DEFAULT_CONNECT_TIMEOUT_MS = 10s，http_get client 设置 connect_timeout
- [x] Task 3: `cargo test` 验证、提交

## 终审清单

- [x] 慢站点响应时间放宽到 30s ✓
- [x] 死链连接快速失败（10s）✓
- [x] cargo test 通过、工作树干净 ✓
