# `<js>` 内嵌块 + java.ajax 支持设计文档

日期：2026-08-15
状态：已批准
前置：已完成 JSON 规则提取（@Json:/$.）、@js: 支持、统一阅读外壳 R1。

## 1. 目标

支持书源规则中的 `<js>...</js>` 内嵌 JS 块与 `java.ajax`。当前规则 `<js>p=baseUrl.replace(/m\./,'www.') java.ajax(p)</js>class.intro.0@html` 会被当成 CSS 选择器抛 `querySelector` 错误。

## 2. 机制（legado 语义，已确认）

- `<js>...</js>` 是**前置 JS 块**：先执行 JS，其中 `java.ajax(url)` 发起网络请求；请求响应 HTML 成为后续 CSS 选择器（after 部分）的提取上下文。
- 示例：`<js>p=...; java.ajax(p)</js>class.intro.0@html` → 执行 JS（ajax 请求 p），用响应 HTML 在新 doc 上以 `class.intro.0@html` 提取书名。
- `java.ajax` 返回值通常不被使用（副作用式），URL 在 JS 内计算。

## 3. 架构

```
parseRule 识别 <js>...</js> 前缀 → { type: "jsBlock", value: 内部JS, after: 剩余部分 }

evalJs 注入 java.ajax：
  java.ajax = (url) => { (ctx as any)._ajaxUrl = String(url); return ""; }   // 同步记录 URL

extractSingle / extractList（async）jsBlock 分支：
  const jsCtx = { doc: emptyDoc(), baseUrl, result, sourceKey };
  evalJs(parsed.value, jsCtx);
  const ajaxUrl = (jsCtx as any)._ajaxUrl;
  if (ajaxUrl) {
    const html = await httpGet(ajaxUrl, mergeUserAgent(srcHeaders, srcUA), undefined, undefined, undefined, undefined, cookieHost);
    doc = parseHtml(html);
  }
  return extractSingle(doc, parsed.after, ctx);   // 递归提取 after 部分
```

### 3.1 parseRule 扩展

```ts
if (s.startsWith("<js>")) {
  const end = s.indexOf("</js>");
  if (end !== -1) {
    return { type: "jsBlock", value: s.slice(4, end), after: s.slice(end + 5).trim() };
  }
}
```
（放在 `@js:` 之后、`##` 之前；`ParsedRule.type` 加 `"jsBlock"`。）

### 3.2 evalJs java.ajax

在 `java` 对象注入 `ajax`：
```ts
ajax: (url: any) => { (ctx as any)._ajaxUrl = String(url ?? ""); return ""; },
```
（ctx 是 evalJs 的参，`_ajaxUrl` 作为带出通道；同步无网络。）

### 3.3 async 化

- `extractSingle`、`extractList`、`extractBookList`、`extractFromJsonObject`、`extractFromElement`、`extractFromJsObject` 全部改 `async`，返回 `Promise<...>`。
- jsBlock 分支 await httpGet；普通分支直接 return（await 一层 Promise.resolve 或直接返回，TS async 自动包装）。
- **httpGet 参数**：jsBlock 需要书源 header/UA/cookie。ctx 扩展 `{ baseUrl, result, sourceKey, source?: BookSource, cookieHost?: string }`。`mergeUserAgent(src.httpHeaders, src.httpUserAgent)` + `cookieHost = source.bookSourceUrl` hostname。

### 3.4 调用方 await

| 文件 | 改 await |
|---|---|
| `src/pages/DiscoverPage.tsx:20` | extractBookList await |
| `src/pages/ExplorePage.tsx:48` | extractBookList await |
| `src/pages/ReaderPage.tsx:85/87` | extractSingle await |
| `src/pages/SourceBookPage.tsx:34-39/45` | extractSingle/extractList await |
| `src/services/sourceDebug.ts` | extractSingle/extractList await |
| 测试 | 批量加 await |

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceEngine.ts` | parseRule jsBlock；java.ajax；async 化 extract 系列 |
| `src/services/bookSourceEngine.test.ts` | 测试加 await + 新增 <js> 用例 |
| 各页面调用点 | await |

## 5. 测试

- `parseRule("<js>...</js>class.x@html")` → `{ type: "jsBlock", value: "...", after: "class.x@html" }`。
- extractSingle 遇 jsBlock 且 ajaxUrl → 调 httpGet（mock）拿 html → after 提取。
- 无 ajaxUrl → after 在原 doc 提取。
- 现有测试（JSON/@js:/CSS）加 await 后保持绿。

## 6. 错误处理

- `<js>` 无闭合 `</js>` → 按普通 CSS 处理（不抛错）。
- httpGet 失败 → evalJs/分支 catch 返回空（不崩溃）。
- java.ajax 调用但 URL 空 → 跳过请求，用原 doc。
