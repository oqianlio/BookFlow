# 阅读体验 R27：会话级章节缓存（重开/换源返回零加载）

> **Status:** Implemented  
> **Date:** 2026-08-15  
> **Scope:** 修复「换源/重新打开刚看过的书又要加载」。

## 背景

用户反馈：换源后回到原书、或退出阅读页马上重开，章节内容又要重新加载。原因：章节内容缓存此前是 **ReaderPage 组件内 ref**（`chapterCacheRef`），组件卸载即丢失；重新打开只能走持久缓存（有「加载中…」闪烁），且漫画（图片章节）不写持久缓存，重开必定重新请求。

## 方案

1. **新增会话级缓存** `src/services/chapterSessionCache.ts`：模块级 `Map`（key = `sourceId:bookUrl:chapterUrl`），App 运行期间保留，上限 30 条、淘汰最旧；提供 `getSessionChapter` / `setSessionChapter` / `clearSessionChapterCache`。
2. **ReaderPage 改用会话缓存**（替换组件内 ref）：`loadChapter` 先查会话缓存命中则直接渲染（并 `setLoading(false)`，修复跨卸载重开时初始 loading=true 卡「加载中…」的问题）；网络/持久缓存加载成功后写入会话缓存；后台预取下一章结果同样写入。
3. **持久缓存保持不变**（长期/离线场景）；漫画章节通过会话缓存获得重开秒开（无需写持久缓存）。

## 效果

- 刚看过的章节，退出阅读页/换源返回后重新打开：**零加载直接显示**，无「加载中…」；
- 换源前后在会话内来回切换书籍均秒开；
- 上限 30 条自动淘汰，不无限占用内存。

## 测试

- `chapterSessionCache.test.ts`：存取、按源/书隔离、超限淘汰最旧。
- `ReaderPage.source.test.tsx`：重开章节不重新请求章节 URL 且无「加载中…」。
