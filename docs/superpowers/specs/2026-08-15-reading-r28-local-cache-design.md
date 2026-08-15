# 阅读体验 R28：本地书重开零加载 + 书源列表短缓存

> **Status:** Implemented  
> **Date:** 2026-08-15  
> **Scope:** 排查「重新打开又要加载」同类问题后的批量优化。

## 排查结论

用户系列问题（末页自动下一章、预加载、会话缓存等）的共同模式是「**重新打开/重复请求又要加载**」。全应用排查出两处同类问题：

1. **本地书（TXT/MD）每次重开重新读盘**：`TxtReader`/`MdReader` 挂载时 `readFileContent(path)` 走 IPC 读整个文件（大文件慢），MD 还要 `marked` 解析——与「重开又要加载」完全同类。
2. **书源列表无缓存**：`listBookSources()` 每次 IPC 查 DB，被章节加载、目录（fetchToc）、搜索、换源面板（N 个候选各调一次）高频重复调用。

## 方案

1. **本地书文本会话缓存** `src/services/localBookCache.ts`：模块级 `path → text` 缓存（上限 5 个文件、淘汰最旧），`TxtReader`/`MdReader` 改用 `readLocalText(path)`——会话内重开本地书零读盘。
2. **书源列表短缓存**：`api.listBookSources()` 增加 10s TTL 模块级缓存；`addBookSource`/`updateBookSource`/`deleteBookSource`/`setBookSourceEnabled` 变更后立即失效（`invalidateBookSourcesCache`）——高频调用不再重复 IPC，且书源管理操作即时生效。

## 不改动

- PDF/EPUB 由 pdfjs/epubjs 从 asset 协议加载（webview 层缓存），暂不处理。
- 进度/统计/书架等轻量查询不缓存。

## 测试

- `localBookCache.test.ts`：首次读盘、二次命中、超限淘汰最旧。
- `TxtReader.test.tsx`/`MdReader.test.tsx`：新增 `clearLocalTextCache` 隔离测试间缓存。
