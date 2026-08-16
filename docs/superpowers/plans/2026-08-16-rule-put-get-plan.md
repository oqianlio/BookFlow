# 实施计划：规则引擎补齐（@put:/@get: 变量语法）

日期：2026-08-16
状态：实施中
前置：spec `2026-08-16-rule-put-get-design.md`（已批准路径上实施）
经验引用：lessons 1.1（真实源用法佐证语义）、1.4（测试先验证假设）、3.29（API 源链路逐环打通）。

## 已完成

1. **工具函数**（bookSourceEngine.ts）：
   - `substituteGetVars`：`@get:{key}` / `@get:key` 结果替换
   - `parsePutPayload`：JSON 对象形式 + 简单形式 + 无引号容错
   - `findPutBlocks`：引号感知括号匹配扫描 @put 块
   - `isPutLiteral` / `evalPutValue`：字面量兜底（`@put:{bookid:"999"}`）
2. **三处提取函数接入**（extractSingle / extractFromJsonObject / extractFromElement）：
   - @put 块剥离 + 副作用执行（值规则按上下文求值）
   - 单独 `@get:` 返回变量值
   - 链内 `get:{k}` 段覆盖（split("@") 后无 @ 前缀）
   - 顶层 wrapper 统一 `substituteGetVars`
   - **顺带修复**：`tag.` 前缀分支移到链式分支之后（`tag.h1@text@get:{k}` 这类链此前被 tag 分支短路）
3. **init 接入**：
   - `applyInitRule`（sourceToc.ts）：@put/@get init 走规则求值，JSON 路径走 applyInitResult
   - sourceToc：bookInfo init + toc 分页 init
   - ReaderPage：正文 init 两处（首次 + 分页页）
   - searchService：ruleSearch.init 支持
4. **测试**（bookSourceEngine.test.ts 新增 10 个用例）：
   - 顶层 @put:{...} + @get:{n}（4020 结构）
   - @get:key 简单形式 / 未设置返回空
   - 链式 @put（爱看书网结构）
   - URL 模板 @get:{key} 替换
   - 无引号容错（红薯阅读 @put:{bid:bid}）
   - extractFromElement @put/@get
   - extractSingle 链式 @get 覆盖
   - 变量跨调用持久

## 验证结果

- 全量测试：527 passed | 3 skipped（519 + 8 新增），tsc --noEmit 干净 ✅
- 真实源冒烟（临时测试，已删除）：
  - 4020：init `@put:{...}` + `@get:{n/a/i/c/t}` 全部正确（name/author/intro/cover/tocUrl）
  - 爱看书网：`$..bookVo.bookName@put:{bookid:...}` 链式 put + chapterUrl `@get:{bookid}` URL 替换 ✅
  - 4020 的 k/l 字段规则（`[property~=category|status|update_time]`、`[property~=las?test_chapter_name]`）含 `|`/`?` 非法 CSS——源自身缺陷，原版 jsoup 同样不命中，非引擎缺口

## 下一步

1. 提交（commit: feat: 规则引擎支持 legado @put:/@get: 变量语法）。
2. 更新经验库（@put 链段无 @ 前缀、tag. 分支顺序坑、字面量兜底、源规则非法 CSS 区分）。
3. 进入书架增强阶段。
