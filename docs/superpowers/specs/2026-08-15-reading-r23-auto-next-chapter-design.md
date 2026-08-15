# 阅读体验 R23：页尾自动进入下一章/下一话

> **Status:** Implemented  
> **Date:** 2026-08-15  
> **Scope:** 修复「翻页到章节末页/漫画最后一张图后，无法自动进入下一章/下一话」的阅读体验问题。

## 背景

用户反馈「自动下一张啊」：阅读书源书籍翻到章节最后一页、或看漫画滚到最后一张图后，不会自动进入下一章/下一话，必须手动点击底部「下一章」按钮。经确认：**不是要自动播放**（A1 自动翻页仍不做），而是修复页尾衔接——翻到末页/末图后自动进入下一章。

## 现状问题

- 书源文字章节由 `PaginatedReader` 渲染：用户翻到最后一页后，`go(page + 1)` 被 clamp 到 `total - 1`，无任何回调通知 ReaderPage 加载下一章。
- 漫画由 `MangaViewer` 渲染：纯图片滚动列表，看到最后一张图后无任何衔接。
- `ReaderPage` 已有 `goChapter(1)`（依赖 `nextContentUrl` 规则提取的 `nextUrlRef`），但没有任何页尾触发器调用它。

## 方案

### 1. PaginatedReader：新增 `onReachEnd` 回调

- 新 prop `onReachEnd?: () => void`。
- 在 `go(p)` 中，当用户翻页触达末页（`total > 0 && c === total - 1`）时调用。
- 初始上报（`useEffect` 中 `onPageChange(0, total)`）**不**触发 `onReachEnd`，避免单页章节一加载就跳章。
- 语义：用户以翻页意图触达末页（含单页章节点击翻页区域），视为读完本章。

### 2. MangaViewer：新增 `onReachEnd` 回调

- 新 prop `onReachEnd?: () => void`。
- 用 `IntersectionObserver` 监听最后一张图片，进入视口即触发一次（触发后 disconnect）。
- jsdom 无 `IntersectionObserver` 时保护性跳过（测试中 mock）。

### 3. ReaderPage：页尾衔接

- 文字章节：`<PaginatedReader ... onReachEnd={() => goChapter(1)} />`
- 漫画：`<MangaViewer images={images} onReachEnd={() => goChapter(1)} />`
- `goChapter(1)` 内部对 `nextUrlRef.current` 为空直接 return，安全无副作用；加载下一章后 `loadChapter` 重置阅读器到第 0 页，进度自动保存。

### 3b. 下一章来源：nextContentUrl 优先，目录（toc）兜底

部分书源没有 `nextContentUrl` 规则（提取不到下一页链接），此时翻到末页无法自动进入下一章。补齐：`goChapter(1)` 优先使用 `nextUrlRef.current`（`nextContentUrl` 规则提取）；为空时回退到已加载的目录 `toc[chapter.index + 1]`（`ruleToc` 提取的章节列表，顺序即阅读顺序），章节名取目录项真实名称。两者都为空时保持静默（底部「下一章」按钮同样 disabled），由用户手动从目录选择。

### 4. 本地书

- 本地 EPUB 由 epubjs 分页引擎天然支持跨章翻页，无需改动。
- 本地 TXT/MD/PDF 为单文件、无章节概念，翻到末尾即全书结束，无「下一章」目标。

## 不改动

- A1 自动翻页（定时自动播放）仍不做。
- 翻页手势/点击区域划分不变。
- 无 Rust 改动。

## 测试

- `PaginatedReader.test.tsx`：翻到末页触发 onReachEnd；初始渲染不触发。
- `MangaViewer.test.tsx`：mock IntersectionObserver，最后一张图 intersect 触发一次。
- `ReaderPage.source.test.tsx`：文字章节点击翻到末页自动加载下一章；漫画末图触发自动加载下一话。
