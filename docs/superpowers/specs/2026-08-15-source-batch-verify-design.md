# 书源批量验证与删除失败源 设计文档

日期：2026-08-15
状态：已批准

## 1. 目标

书源管理页新增两个操作：

1. **批量验证**：一键对全部启用书源执行真实搜索（关键词 斗破苍穹），
   逐个显示结果（✓ N本 / ✗ 失败原因），顶部实时进度。
2. **批量删除失败源**：验证完成后一键删除失败书源（带确认弹窗）。

## 2. 实现

### 2.1 服务层 `src/services/sourceVerify.ts`（新增）

- `verifySource(bs, keyword)`：与健康检查同逻辑 —— `resolveSearchUrl` →
  `httpGet`（生产 Rust 网络层，含 cookie jar / GBK 编码回退）→
  `extractBookList`。返回 `{ id, name, ok, count, ms, reason }`。
- `verifySources(sources, { keyword, concurrency=10, onProgress, shouldCancel })`：
  并发执行，按输入顺序返回；进度回调 `(done, total, result)`；支持取消。

### 2.2 界面 `src/components/BookSourceManager.tsx`

- 「批量验证（启用源）」按钮 + 验证中进度「验证中 done/total…」+ 取消按钮。
- 每个书源行显示徽标：`✓ N本`（绿）或失败原因（红，title 含耗时）。
- 完成后显示「可用 X / Y」与「删除失败源（N）」按钮；删除前 ConfirmDialog
  列出前 6 个失败源名，确认后逐个 `deleteBookSource`，完成后刷新列表。

### 2.3 样式 `src/App.css`

- `.source-verify-bar`、`.verify-summary`、`.verify-badge.ok/.fail`。

## 3. 测试

- `src/services/sourceVerify.test.ts`：成功/无结果/无搜索URL/网络错误、
  并发顺序与进度、取消语义。
- `BookSourceManager.test.tsx`：验证流（仅启用源被验证、徽标、汇总）、
  删除失败源（确认弹窗 → deleteBookSource）。

## 4. 说明

- 验证仅针对启用源（搜索实际使用的源）；停用源不验证、不显示徽标。
- 单源 8s 超时，10 并发；274 源最坏约 4 分钟，可随时取消。
