# 今日开发计划（2026-08-15）

> 状态：**全部完成**（2026-08-15）。提交见各节。

## 现状

- 书源规则引擎按 legado 语法逐步实现，真实源验证驱动：可用源 16 → 64/274
  （"我的"关键字）/ 56/274（斗破苍穹）。
- 批量验证 + 删除失效源已完成（学习原版 CheckSource 分组标记机制）。
- 工作树干净；`npm test` 430 通过、`npm run build` 干净。

## 目标

围绕两条主线：**规则引擎剩余缺口**（真实源点不开书/提取不到字段）与
**批量验证补全**（原版全量检测 + 配置 UI）。每步独立提交，测试先行。

---

## 批次 1：规则引擎缺口（真实源驱动）

### 1.1 `##` 正则替换作用于节点 outerHtml（随心看 bookUrl）
- 现状：`extractFromElement` 无 regexReplace 分支 → 返回空。
- 真实影响：随心看 bookUrl 规则 `##="newWebView\('([^']+)'##$1###` 提取为空，
  搜索能出 15 本但点不开书。
- 做法：parseRule 拆出 `##正则##替换` 的 body + replace 对；body 为空时对
  节点 outerHtml 做替换（legado 行为）；`##="…"###` 变体对齐。
- 验证：单源调试随心看 bookUrl 非空；健康检查回归。
- 提交点：`feat: ## 正则替换作用于节点 outerHtml（随心看 bookUrl）`

### 1.2 item 内链式规则 `A@B@C`
- 现状：extractList 支持链式，但 extractFromElement（name/bookUrl 等 item
  规则）不支持 `.row@a@text` 类链式。
- 做法：extractFromElement 增加链式处理（前段选节点、后段取属性/文本），
  复用 queryIndexed/selectNodesSafe。
- 验证：新测试 + 真实源 spot check。

### 1.3 `[-1]` 负索引（class.recommend[-1]）
- legado 支持负索引取倒数第 N 个；queryIndexed 补 `[N]`/`[-N]` 括号索引
  解析（含 `.class[-1]` 变体）。
- 验证：单元测试覆盖正/负/越界。

## 批次 2：批量验证补全（学习原版）

### 2.1 检测项扩展：目录 / 正文 / 详情
- 现状：verifySource 只检测"搜索"。
- 做法：按原版 checkCategory/checkContent/checkInfo 语义，搜索到第一本书后
  继续校验 ruleToc 目录与 ruleContent 正文（复用引擎 extractToc/extractContent
  能力），失败分组标记沿用原版文案（搜索目录失效/搜索正文失效等）。
- 验证：单源调试 + 服务测试。

### 2.2 检测配置：关键字 / 并发 / 检测项开关
- 书源管理"批量验证"旁增加配置入口（关键字、并发数、检测项复选框），
  存 localStorage（对应原版 CheckSource.putConfig / CacheManager）。
- 验证：UI 测试。

## 批次 3（视时间）

### 3.1 respondTime 更新与按响应排序
- verifySource 记录耗时写回书源 JSON（respondTime 字段），书源管理支持按
  响应快慢排序（原版 BookSourceSort.Respond）。

---

## 验收标准

- 每步 `npm test` 全绿 + `npm run build` 干净 + 独立 commit。
- 1.1 完成时真实验证：随心看书源 bookUrl 可提取、能打开书。
- 批次 2 完成时：批量验证可对单源做"搜索+目录+正文"全量检测。

## 完成记录

| 项 | 提交 | 结果 |
|---|---|---|
| 1.1 `##` 正则替换（outerHtml） | `19511f6` | 随心看 bookUrl 15/15 提取成功 |
| 1.2 item 内链式 A@B@C | `2873ade` | +6 测试；queryIndexed 回退修复 |
| 1.3 `[-1]` 负索引 | `b657abe` | [N]/[-N]、tag. 前缀、属性选择器不受影响 |
| 2.1 目录/正文检测 | `dc4f5bc` + `8ca7c2d` | 真实源实测 72→9 误杀 → ok 由搜索判定，目录/正文失败仅作质量标记（黄徽标） |
| 2.2 检测配置 UI | `1293154` | 关键字/并发/检测项开关，localStorage 持久化 |
| 3.1 respondTime + 排序 | `df785c4` | 响应耗时写回；默认/名称/响应速度排序 |

最终状态：`npm test` 456 通过 | 1 跳过；`npm run build` 干净；工作树干净。
