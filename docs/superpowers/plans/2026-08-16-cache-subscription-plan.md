# 实施计划：缓存与订阅管理（章节缓存明细 / 订阅自动刷新 / RSS 已读 + OPML）

日期：2026-08-16
状态：实施中
前置：spec 规划（本节并入本次计划说明）。
经验引用：lessons 3.18（日志调试）、2.1（write/edit 改文件）。

## 目标

用户选定"缓存与订阅管理（章节缓存管理 UI、书源订阅自动定时刷新、RSS 已读状态与 OPML 导入导出）"。

## 已完成

1. **章节缓存管理 UI**（SettingsPage）：
   - 后端新增 `list_cached_books`：按书聚合缓存（书名优先书架记录，否则 URL 最后一段；
     章数 + 字节 + 最近更新）
   - 前端缓存设置区新增「查看明细」：按书列表（书名/章数/大小），逐书清除（delete_book_cache）
   - 保留原有总览统计 + 清除全部

2. **书源订阅自动定时刷新**（BookSourceManager）：
   - 打开书源管理页时，超过 24h 未检查的订阅自动同步（静默失败，成功有提示）
   - 新增「全部同步」按钮（串行逐个同步，汇总 新增/更新/失败）
   - 单源同步保持原有行为

3. **RSS 已读状态**：
   - DB：rss_articles 加 `is_read` 列 + 旧库迁移（pragma_table_info 检测补列）
   - 命令：mark_rss_article_read / mark_rss_feed_read / rss_unread_count
   - RssPage：订阅源未读徽标、文章未读圆点、已读样式、全部已读按钮；
     打开文章乐观标记已读（列表即时刷新 + 未读计数递减）
   - RssArticlePage：加载文章即标记已读（幂等）

4. **OPML 导入导出**（RssPage）：
   - 导出：全部订阅 → OPML 文本 → 浏览器下载 rss-subscriptions.opml
   - 导入：文件选择 → 解析 xmlUrl → 逐个抓取添加（跳过已存在），返回新增数

## 测试

- Rust：rss_article_read_state（已读标记/未读计数/全部已读）、cached_books_aggregation
  （聚合/URL 兜底）——cargo test 全绿
- TS：RssPage 新增 3 用例（未读标记、全部已读、OPML 导出）；RssArticlePage 标记已读；
  SettingsPage/App.test 补 listCachedBooks/deleteBookCache mock
- 全量 vitest + tsc 验证中

## 下一步

1. 全量测试确认 → 提交
2. 更新经验库
