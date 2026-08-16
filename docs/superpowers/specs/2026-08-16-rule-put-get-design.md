# 书源规则引擎 R23：`@put:` / `@get:` 变量语法兼容

日期：2026-08-16
状态：待批准
前置：tmp_sources.json 真实源扫描发现 6 个源使用 `@put:`/`@get:`（4020、夜伴书屋、寒武纪年、抖音小说、爱看书网、红薯阅读），当前引擎均不识别 → 这些源书籍信息/章节链接提取为空。
经验引用：lessons 1.1（学习原版必须核对源码，此处用真实源用法佐证语义）、1.4（测试先验证假设）、3.29（API 源打不开是规则链缺口，逐环打通）。

## 1. 目标

让规则引擎支持 legado 变量语法：
- `@get:{key}` / `@get:key` —— 读取变量（单独作为规则、链尾、URL/请求体模板内）
- `@put:{key:value,...}` —— JSON 对象形式一次存多个变量（值部分是规则，求值后存储）
- `@put:key:value` —— 简单形式
- 变量与现有 `java.put/get`（sourceVars per-source Map）共用同一存储，语义一致。

## 2. 背景与问题

### 2.1 真实源用法（tmp_sources.json 扫描确认）

**4020 / 夜伴书屋 / 抖音小说**（HTML 书源）：
```json
"ruleBookInfo": {
  "init": "@put:{n:\"[property$=book_name]@content\", a:\"[property$=author]@content\", ...}",
  "name": "@get:{n}", "author": "@get:{a}", ...
}
```
init 里用 CSS 规则提取各字段存变量，name/author 等用 `@get:{n}` 读取。当前：init 走 `applyInitResult`（只认 JSON 路径）→ 原样返回；`@get:{n}` 被 parseRule 当属性规则 `attr=get:{n}` → 空。**书籍信息全空**。

**爱看书网**（API 源）：
```json
"ruleBookInfo": { "name": "$..bookVo.bookName@put:{bookid:$..bookVo.bookId}" },
"ruleToc": { "chapterUrl": "https://cxb-pro.cread.com:443/cx/itf/chapterRead?bookId=@get:{bookid}&chapterId={{$.id}}&full=0" }
```
链式 put（`提取@put:{...}` 返回提取值、存变量）+ URL 模板内 `@get:` 替换。当前：`$..bookVo.bookName@put:{...}` 的 @put 段导致 jsonGet 路径错误 → 空；chapterUrl 的 `@get:{bookid}` 不替换 → 请求 URL 带字面 `@get:{bookid}`。

**红薯阅读**：
```json
"ruleBookInfo": { "name": "$.catename@put:{bid:bid}" }
```
值 `bid` 是无引号字面（JSON 对象键的引用）→ 需容错解析。

**寒武纪年**：
```json
"ruleToc": { "chapterUrl": "https://api.hanwujinian.net/api.php/api/book_app/read,{\"body\":\"aid=@get:{a}&cid={{$.chapterid}}&uid=0\",\"method\":\"POST\"}\n@js:\n\"{{$.chaptertype}}\"==\"1\"?\"\":result" }
```
`@get:{a}` 在 POST body 模板内（注意此源 ruleBookInfo 无 put，`a` 需外部注入或为空——原版同样场景，机制支持即可）。

### 2.2 现状代码路径

- `extractSingle`（顶层规则）：`@get:{n}` → parseRule → parseAttrRule → `body.startsWith("@")` → `attr = "get:{n}"` → `node.getAttribute("get:{n}")` → 空。
- `extractFromElement` / `extractFromJsonObject`（item 规则）：`$..x@put:{...}` 的 @put 段未剥离 → jsonGet 路径含 `@put:{...}` → undefined → 空。
- `applyInitResult`（sourceToc/ReaderPage）：只处理 JSON 路径 init（`$.data.bookInfo`），`@put:` init 原样返回，变量不落库。
- URL 模板 `bookId=@get:{bookid}`：提取结果为字面字符串，无替换。

## 3. 语义（对齐 legado AnalyzeRule）

- **`@get:key`**（含 `@get:{key}` 花括号形式）：读取变量；单独作为整条规则时返回变量值；出现在链中时替换为变量值。
- **`@put:{key:value,...}`**：值部分按规则求值（上下文：document/element/json object），结果存入变量；**规则本身返回空**（副作用规则）。
- **`@put:key:value`**：同上，单变量。
- **链式 `A@put:{...}`**：先提取 A（返回值），put 为副作用（不改变链结果）。`A@get:{k}`：A 提取后结果替换为变量值（legado 链语义 get 覆盖）。
- **模板内 `@get:`**：URL/body/文本模板中的 `@get:{key}` 字面替换为变量值（不做链拆分）。
- **变量作用域**：per-source（与现有 java.put/get 的 sourceVars 一致）。跨请求链共享——比 legado 原版（每次请求链新建 ruleMap）更宽松，但与本项目既有实现一致，且真实源用法（init→get 同一请求链内）不受影响。

## 4. 架构设计

### 4.1 变量工具函数（bookSourceEngine.ts 内新增）

```ts
/** @get:{key} / @get:key → 变量值；无匹配原样返回 */
function substituteGetVars(s: string, sourceKey?: string): string
/** 从规则串中解析 @put 载荷（JSON 对象形式或 key:value 简单形式） */
function parsePutPayload(s: string): Array<[string, string]> | null
/** 扫描规则串，返回所有 @put:{...} 块（引号感知的括号匹配） */
function findPutBlocks(s: string): Array<{ start: number; end: number; payload: string }>
```

- `substituteGetVars`：`/@get:\{([^}]+)\}|@get:([\w-]+)/g` 替换。
- `parsePutPayload`：先 `JSON.parse`（值带引号），失败则手动按顶层逗号/冒号拆分（容错无引号键值）。
- `findPutBlocks`：从 `@put:{` 起做引号感知括号匹配，返回块区间（供剥离）。

### 4.2 三处提取函数接入（副作用 + 剥离）

统一模式：**先剥离并执行 @put 块，再走原提取路径，最后替换 @get**。

**extractSingle**（doc 上下文，async）：
1. 入口：mask `<js>...</js>` / `@js:...` 后扫描 `@put` 块 → 每块值用 `extractSingle(doc, valueRule, ctx)` 求值 → `vars.set(key, value)`；从规则串移除块。
2. 剥离后若规则串为空 → 返回 ""（纯 put 规则）。
3. 若规则串 trim 后以 `@get:` 开头 → 返回变量值（`@get:{key}` / `@get:key`）。
4. 其余走原逻辑；**返回值统一经 `substituteGetVars`**（顶层 wrapper 实现，见 4.4）。

**extractFromElement**（element 上下文，sync）：
1. 同上剥离/执行 @put（值用 `extractFromElement(el, valueRule, baseUrl)` 求值）。
2. 纯 put → ""；`@get:` 开头 → 变量值。
3. 原逻辑；返回值经 substituteGetVars（wrapper）。

**extractFromJsonObject**（json object 上下文，sync）：
1. 同上剥离/执行 @put（值用 `extractFromJsonObject(obj, valueRule, ctx)` 求值）。
2. 纯 put → ""；`@get:` 开头 → 变量值。
3. 原逻辑（含 {{}} 模板分支）；返回值经 substituteGetVars（wrapper）。

### 4.3 链式处理（extractSingle / extractFromElement 的 A@B@C 链）

- 链段扫描时：段以 `@get:` 开头 → 取变量值作为链结果（覆盖）；段以 `@put:` 开头 → 执行副作用后跳过（链结果不变）。
- 注意 @put 块内含 `@`（如 `[property$=book_name]@content`），**不能按 `@` 简单 split 链段**——链检测放在 @put 块剥离之后（此时块已移除，剩余 @ 分隔的是真实链段）。
- extractFromJsonObject 无链式（路径规则）；{{}} 模板分支内不处理 @put。

### 4.4 顶层 wrapper（替代逐调用点替换）

为避免在十余处 `finalize(...)` 调用点各加替换，将三个导出函数改造成"内部实现 + 导出 wrapper"：

```ts
async function extractSingleInner(doc, rule, ctx): Promise<string> { ...原逻辑... }
export async function extractSingle(doc, rule, ctx): Promise<string> {
  return substituteGetVars(await extractSingleInner(doc, rule, ctx), ctx?.sourceKey);
}
```
- extractFromElement / extractFromJsonObject 同构（sync wrapper）。
- 模块内部递归调用保持原函数名（解析到 wrapper，幂等无害）。
- **注意**：`extractList` / `extractBookList` / `extractItemValue` 内部对 item 字段的调用走 wrapper → 自动获得替换。

### 4.5 init 规则扩展（sourceToc.ts / ReaderPage.tsx / searchService.ts）

新增导出（放 bookSourceEngine.ts 或 sourceToc.ts）：

```ts
/** init 规则统一处理：JSON 路径（$.x）走 applyInitResult；@put/@get 走规则求值（副作用落变量，result 不变） */
export async function applyInitRule(doc: Document, init: string | undefined, html: string, ctx: ExtractContext): Promise<string>
```

- init 以 `@put:` 或 `@get:` 开头 → `await extractSingle(doc, init, {...ctx, result: html})`，返回原 html（变量副作用已落库）。
- 否则 → `applyInitResult(init, html)`。

调用点替换：
- sourceToc.doFetch：`biResult = await applyInitRule(doc, bi.init, html, {...})`；目录分页循环内 `pageResult = await applyInitRule(curDoc, rules.init, curHtml, {...})`。
- ReaderPage.tsx 正文 init（两处：首次 + 分页页）。
- searchService.searchSource：新增 `rules.init` 处理（legado ruleSearch 有 init 字段；extractBookList 前调用）。

### 4.6 变量存储

复用 `getSourceVars(sourceKey ?? "default")`（sourceVars.ts 现有 per-source Map，java.put/get 已用）。新增测试需 `resetSourceVars` 清理，避免跨测试泄漏（lessons 3.33 同类问题）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceEngine.ts` | substituteGetVars / parsePutPayload / findPutBlocks + 三函数接入 + wrapper + init 处理入口 |
| `src/services/sourceToc.ts` | applyInitRule 使用（bookInfo + toc 分页两处） |
| `src/pages/ReaderPage.tsx` | 正文 init 两处改用 applyInitRule |
| `src/services/searchService.ts` | ruleSearch.init 支持 |
| `src/services/bookSourceEngine.test.ts` | @put/@get 单测 |
| `src/services/sourceToc.test.ts` | init 规则单测 |

## 6. 测试计划

1. **extractSingle 顶层**：
   - `@put:{n:"tag.h1@text"}` 存变量（返回 ""）；随后 `@get:{n}` 返回存储值。
   - `@get:{n}` 未设置 → ""。
   - `@get:key` 简单形式。
2. **链式**：`tag.h1@text@put:{k:href}` → 返回 tag.h1 文本且存 k；`tag.h1@href@get:{k}` → 返回变量值。
3. **extractFromJsonObject**：`$.name@put:{bookid:$.id}` → 返回 name、存 bookid；URL 模板 `https://x?id=@get:{bookid}&cid={{$.id}}` → 两处替换。
4. **extractFromElement**：`a@href@put:{u:text}` → 返回 href、存 u；`@get:{u}` 读取。
5. **无引号容错**：`@put:{bid:bid}` → JSON.parse 失败走手动拆分，存 "bid"（json 上下文 obj.bid）。
6. **init**：`@put:{...}` init 后 name/author 从变量读到（模拟 4020 结构）；JSON 路径 init 行为不变（回归）。
7. 现有 519 测试保持绿；`npm run build` 干净。

## 7. 错误处理

- @put 值求值失败（规则非法）→ 存空串，不中断。
- @put 载荷解析失败（JSON 与手动拆分都失败）→ 忽略该块，规则按剥离后处理。
- @get 键不存在 → ""。
- 替换正则只匹配 `@get:{...}` / `@get:[\w-]+`，不影响 URL 中其他 `@` 用法。

## 8. 验证

- 单测覆盖上述场景。
- 真实源验证：对 4020 / 爱看书网 书源跑 fetchToc 路径（SOURCE_HEALTH 门控脚本风格，lessons 3.27 用常量开关），确认书籍信息非空。
