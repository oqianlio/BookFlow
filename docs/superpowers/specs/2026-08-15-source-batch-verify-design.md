# 书源批量验证与删除失效源 设计文档

日期：2026-08-15
状态：已批准

## 1. 目标

书源管理页新增两个操作：

1. **批量验证**：一键对全部启用书源执行真实搜索（关键词 斗破苍穹），
   逐个显示结果（✓ N本 / ✗ 失败原因），顶部实时进度。
2. **批量删除失败源**：验证完成后一键删除失败书源（带确认弹窗）。

## 2. 学习原版（legado CheckSource）后的机制

参考 legado 原版 `CheckSourceService.kt` / `BookSource.kt` 改造：

1. **检测关键字默认 "我的"**（原版 `CheckSource.keyword`）；书源可用
   `ruleSearch.checkKeyWord` 覆盖（原版 `getCheckKeyword`）。
2. **检测结果写入书源分组**（原版核心机制）：
   - 失败 → `bookSourceGroup` 加标记：搜索失效 / 网站失效 / 校验超时 /
     js失效 / 搜索链接规则为空（对应原版 `addGroup` 文案）；
   - 成功 → 清除全部失效标记（原版 `removeInvalidGroups`）；
   - 标记持久化到书源 JSON（`updateBookSource`），重启仍有效。
3. **"删除失效源"按失效分组筛选**（原版 `getInvalidGroupNames`：
   分组名含"失效"或等于"校验超时"），不依赖当次会话。
4. 失效分组自然出现在分组列表中（如"搜索失效"分组），与原版一致。

## 3. 实现

### 3.1 服务层 `src/services/sourceVerify.ts`

- `verifySource(bs, keyword)`：关键字 = 参数 ?? ruleSearch.checkKeyWord ??
  "我的"；搜索流程同健康检查；返回 `{ id, name, ok, count, ms, reason, group }`。
- `failureGroup(reason)`：失败原因 → 分组标记（legado 文案）。
- `updateSourceGroups(json, addGroup)`：改 bookSourceGroup（先移除全部失效
  标记，再加入新标记）；无变化时返回原 json（避免无谓持久化）。
- `isInvalidGroup(group)` / `invalidGroupNames(json)`：legado getInvalidGroupNames。
- `verifySources(sources, { concurrency=10, onProgress, shouldCancel, persist })`：
  并发执行，每完成一个持久化分组标记（默认 `updateBookSource`）。

### 3.2 界面 `src/components/BookSourceManager.tsx`

- 「批量验证（启用源）」按钮 + 进度 + 取消；每源徽标（✓ N本 / 失败原因）；
  完成后刷新列表（展示持久化后的失效分组）。
- 「删除失效源（N）」：N = 按失效分组筛选的书源数（持久化，重启仍显示）；
  确认弹窗列出前 6 个名字后逐个删除。

### 3.3 样式 `src/App.css`

- `.source-verify-bar`、`.verify-summary`、`.verify-badge.ok/.fail`。

## 4. 测试

- `src/services/sourceVerify.test.ts`：关键字默认/checkKeyWord 覆盖、
  failureGroup 分类、updateSourceGroups 增删/幂等、invalidGroupNames、
  成功/失败/无搜索URL/网络错误、并发顺序与进度、取消、持久化调用。
- `BookSourceManager.test.tsx`：验证流（徽标、汇总、仅启用源）、
  失效分组按钮（无需验证）、删除失效源（确认 → deleteBookSource）。

## 5. 与原版的差异（有意为之）

- 仅检测"搜索"一项；原版默认还检测发现/详情/目录/正文（引擎已具备
  extractList/extractToc 能力，后续可加）。
- 未实现 respondTime 更新与智能排序（weight）。
- 未实现检测项开关与超时配置 UI（原版 CheckSource 配置对话框）。
