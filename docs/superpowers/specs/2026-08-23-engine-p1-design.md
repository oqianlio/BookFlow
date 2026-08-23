# P1 引擎补齐：变量四层 scope + URL 选项剥离 + evalJs null 容错 设计文档

日期：2026-08-23
状态：已批准

> 来源：docs/plan.md P1（对齐 legado 原版）。经验引用：lessons 3.18/3.20（真实源 evalJs 报错）、health-baseline 下一步 3（红薯阅读 trim 报错 → evalJs null 处理增强）。

## 1. 背景与目标

三个引擎缺口导致部分 legado 书源不可用：

1. **变量单层**：`sourceVars.ts` 只有 source 级一层，`java.put/get` 与 `source.getVariable/putVariable` 共用同一命名空间；evalJs 的 `book`/`chapter` 是空对象。依赖 `book.getVariable()`/`chapter.putVariable()` 或跨章变量的源无法工作。
2. **URL 选项未剥离**：规则提取出的 tocUrl/chapterUrl/正文 URL 若带 legado 的 `,{...}` 请求选项后缀（如 `https://x/c,{"method":"POST","body":"id=1"}`），选项被当作路径请求 → 404；POST 型章节 URL 完全不可用。目前仅 searchUrl 解析了选项（parseSearchUrl）。
3. **null 污染**：规则结果为 null 时 `String(null)` 产生字面量 `"null"` 字符串流入下游（章节 URL 变 `"null"`）；红薯阅读 trim 类报错即此场景。

**参考**：legado 变量四层 chapter→book→session→source；legado AnalyzeUrl 的 URL+JSON 请求选项语法。

## 2. 非目标

- 不做变量持久化到 DB（保持会话级内存，重启丢失——与现有行为一致）。
- 不支持 `webView:true` 真实 WebView 抓取（忽略该选项按普通 GET 处理）。
- 不改 searchUrl 现有 parseSearchUrl 行为（已工作）。
- 不实现 legado 全部 JsExtensions API。

## 3. 技术架构

### A. 变量四层 scope

```
chapter: `${sourceKey}|${bookUrl}|${chapterUrl}` → Map<k,v>   章内（内存）
book:    `${sourceKey}|${bookUrl}`           → Map<k,v>   书内跨章（内存）
session: `${sourceKey}`                      → Map<k,v>   java.put/get 专用
source:  `${sourceKey}` 独立命名空间          → Map<k,v>   source.get/setVariable 专用
```

- `sourceVars.ts` 重构为四层存取 API：
  - `getScopedMap(layer, key)` 内部工具；导出面向用例的函数：
    - `javaGet/javaPut(sourceKey, k, v)` — session 层（现 java.put/get 迁入，不再与 source 层共用）
    - `sourceVarGet/sourceVarSet(sourceKey, v)` — source 层（"variable" 单值语义不变）
    - `bookVarGet/bookVarPut(bookKey, k?, v?)`、`chapterVarGet/chapterVarPut(chapterKey, ...)` — book/chapter 层
  - `resetSourceVars(sourceKey)` 清空该源全部四层。
- 兼容迁移：现有数据在 session/source 两层的旧混用 key（"variable"）保留读取兼容——source 层读不到时回退 session 层读一次（一次性软迁移，不写回）。
- `JsContext` 增加可选 `bookKey?: string`、`chapterKey?: string`。
- `evalJs` 注入：
  - `book.getVariable(k?) / book.putVariable(k, v) / book.setVariable(...)` — bookKey 存在时读写 book 层；不存在时空实现（返回 ""）
  - `chapter.getVariable(k?) / chapter.putVariable(k, v)` — 同理 chapter 层
  - legado 语义：`putVariable(v)` 单参 = 写 "variable"；双参 = 写指定 key。getVariable() 无参读 "variable"，带 key 读指定 key。
- 调用方接线（透传 bookKey/chapterKey 到提取 ctx）：
  - `sourceToc.ts` fetchToc：传 bookKey=resolvedBookUrl（无章节上下文）
  - ReaderPage `fetchChapterData`→fetchChapterContent 链路：bookKey=bookUrl、chapterKey=chapterUrl
  - searchService/searchUrl/探索：不传（无书上下文，book/chapter 方法为空实现）

### B. URL `,{...}` 选项

- 新增导出 `splitUrlOptions(url: string): { url: string; opts: UrlOpts | null }`：
  - 找顶层 `,{`（不在引号内），`JSON.parse` 尾段成功且为对象 → 剥离并返回 opts；
  - 解析失败/无匹配 → `{ url, opts: null }`（原样）。
- `resolveUrl` 出口统一剥离：返回前先 splitUrlOptions，只保留 url 部分（所有提取到的 URL 干净化——展示、缓存、比较均不受污染）。
- 抓取点透传请求选项：sourceToc 的 tocUrl 抓取、正文抓取（ReaderPage/chapterCache/sourceVerify 共用的 fetchChapterData 链路）在 httpGet 前 splitUrlOptions，将 `opts.method/body/charset` 传给 httpGet 已有的 method/body 参数；charset 用于 body 编码沿用 encodeKeyByCharset 思路（仅 body 为 gbk 场景转码，罕见则跳过）。
- `webView:true` 及未知选项忽略。

### C. evalJs null 容错

- 新增内部 `normStr(v): string`：`v == null || v === "null"` → `""`；其余 String(v)。
- 应用到出口：
  - extractSingle / extractFromJsonObject / extractFromElement 最终 return（含 js 分支、模板分支）
  - resolveUrl 入参 href 先 normStr（防 `"null"` 进 URL）
  - toc/chapter 列表项字段归一化（title/url/name 空值剔除已有，补 "null" 字面量剔除）
- match 失败类异常维持 evalJs catch → ""（现状），补测试固化：`@js:result.match(/x/)[1]` 返回 "" 不抛错。

## 4. 文件改动

| 文件 | 改动 |
|---|---|
| `src/services/sourceVars.ts` | 重构为四层 API + reset 清全部层 |
| `src/services/sourceVars.test.ts` | 四层隔离/就近语义/兼容回退测试 |
| `src/services/bookSourceEngine.ts` | JsContext 加 bookKey/chapterKey；evalJs 注入 book/chapter 方法；splitUrlOptions + resolveUrl 剥离；normStr 出口归一化 |
| `src/services/bookSourceEngine.test.ts` | 变量四层、URL 选项剥离、null 归一化测试组 |
| `src/services/sourceToc.ts` | tocUrl/章节列表提取传 bookKey；tocUrl 抓取点透传 options |
| `src/pages/ReaderPage.tsx` | fetchChapterData 链路传 bookKey/chapterKey；正文抓取透传 options |
| `src/services/chapterCache.ts` | 章节批量缓存抓取点透传 options |

## 5. 测试

- sourceVars.test.ts：四层互不串、chapter 键含 bookUrl 维度、resetSourceVars 清四层、"variable" 旧数据 session→source 回退可读。
- bookSourceEngine.test.ts：
  - evalJs 中 `book.putVariable('k','v'); book.getVariable('k')` 往返；`chapter.putVariable('x'); chapter.getVariable('x')`；无 bookKey 时方法存在但不抛错返回 ""。
  - `splitUrlOptions('https://a/b,{"method":"POST","body":"id=1"}')` → url 干净 + opts 正确；普通 URL 原样；非法 JSON 尾段原样。
  - resolveUrl 剥离后不含 `,{`。
  - null 归一化：js 返回 null 的规则结果为 ""；URL 字段无 "null" 字面量。
  - 现有 @put/@get 测试保持绿（回归保障：session/source 分离后旧断言语义不变处微调）。
- 手工验证：红薯阅读正文链路不再报 trim 错误（站点可用时）。

## 6. 交付文件

同第 4 节表格，共 7 个文件。

## 7. 已知限制

- 变量为会话级，应用重启丢失（与现状一致）。
- webView 选项被忽略，需要 JS 渲染的页面仍取不到内容。
- charset 仅处理 gbk/gb2312/gb18030 body 转码，其他编码按 utf-8。
