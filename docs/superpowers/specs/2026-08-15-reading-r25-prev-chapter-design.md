# 阅读体验 R25：章节首页向前翻页进入上一章

> **Status:** Implemented  
> **Date:** 2026-08-15  
> **Scope:** 修复「翻页不能翻到上一章节」：在章节第一页继续向前翻页，应进入上一章节。

## 背景

用户反馈：翻页不能翻到上一章节。现状：`PaginatedReader` 在首页点击左侧（上一页）被 clamp 在第 0 页，无任何衔接；底部「上一章」按钮依赖阅读历史栈 `prevUrlsRef`，直接进入章节（目录跳转/进度恢复）时栈为空，无法进入上一章。

## 方案

1. **PaginatedReader 新增 `onReachStart` 回调**：用户翻页动作触达第 0 页（`c === 0`）时调用（与 `onReachEnd` 对称）；初始渲染上报不触发。
2. **ReaderPage 接入**：`<PaginatedReader onReachStart={() => goChapter(-1)} />`。
3. **`goChapter(-1)` 上一章来源**：阅读历史栈 `prevUrlsRef` 优先；栈为空时回退到目录 `toc[chapter.index - 1]`（与下一章的 `nextContentUrl → toc` 兜底对称）。第一章无上一章时静默。
4. **底部「上一章」按钮**：disabled 条件由「栈为空」改为「栈为空且目录无上一章」——直接进入章节时也可通过目录进入上一章。

## 不改动

- 漫画为滚动阅读，无「翻页」动作，不加翻页跨话（底部按钮与目录可用）。
- 翻页手势/点击区域划分不变。

## 测试

- `PaginatedReader.test.tsx`：首页点击左侧触发 `onReachStart`；初始渲染/非首页不触发。
- `ReaderPage.source.test.tsx`：直接进入第二章（无历史栈），首页点击左侧经目录进入第一章；底部「上一章」按钮在目录有上一章时可用。
