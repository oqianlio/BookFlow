# @js: 书源支持设计文档

日期：2026-08-10
状态：已批准

## 1. 背景与目标

「枕书」书源功能此前不支持 `@js:` 表达式（CSP 安全限制，spec 2026-08-07-book-sources-design.md §12 已知限制）。但部分真实书源（如番茄小说聚合 API）重度依赖 `@js:`，导致这些书源无法使用。

**目标**：在前端 JS 运行时模拟 legado 环境，支持 `@js:` 表达式执行，覆盖大多数 `@js:` 书源（搜索、目录、正文、URL 构造）。

**非目标**：
- 不完整兼容 legado 全部 Java API（`source.getVariable` 等高级调用按需补充）
- 不引入 wasm JS 引擎（方案 B 已否决）
- 不沙箱隔离（用户自粘贴可信内容，风险可接受，全局 CSP 放宽）

## 2. 技术架构

```
前端规则引擎 (WebView)
┌────────────────────────────────────────────┐
│ evalJs(expr, ctx)                          │
│  · 书源上下文: key, page, result, source,  │
│    baseUrl, node, doc, java, url           │
│  · java 模拟: encodeURI, base64Decode,     │
│    regex, md5, md5Encode, random, ...       │
│  · CSP: script-src 'unsafe-eval'           │
├────────────────────────────────────────────┤
│ @js: 接入点                                 │
│  · searchUrl 构造（返回 URL 字符串）         │
│  · bookList 提取（返回对象数组 / JSON 串）   │
│  · bookUrl / name / author / cover 取值     │
│  · content 提取（返回 HTML/文本）            │
└────────────────────────────────────────────┘
```

- CSP 在 `tauri.conf.json` 的 `app.security.csp.script-src` 加 `'unsafe-eval'`。
- `@js:` 执行集中在 `bookSourceEngine.ts` 的 `evalJs`，扩展上下文与 `java` 模拟对象。
- `extractList` 增加 `@js:` 分支：`@js:` 返回的数组（或 JSON 串）作为列表项。

## 3. evalJs 扩展

当前 `evalJs(expr, ctx)` 签名扩展为：

```ts
export interface JsContext {
  node?: Element;        // 当前节点（列表项/文档级）
  doc: Document;         // 解析后的文档
  result?: string;       // 前一步结果（如 bookList 迭代中的当前项 JSON）
  baseUrl?: string;
  key?: string;          // 搜索关键词
  page?: number;         // 当前页（默认 1）
  source?: any;          // 书源对象（含 getVariable 等最小实现）
}

export function evalJs(expr: string, ctx: JsContext): any  // 返回任意 JS 值，不再强制 String
```

`java` 模拟对象（按需扩展）：

```ts
const java = {
  encodeURI: (s: string) => encodeURIComponent(s),
  decodeURI: (s: string) => decodeURIComponent(s),
  base64Decode: (b64: string) => new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
  base64Encode: (s: string) => btoa(String(s)),
  regex: (input: string, pattern: string) => {
    const m = String(input).match(new RegExp(pattern));
    return m ? (m[1] ?? m[0]) : "";
  },
  md5: (s: string) => md5(String(s)),       // 用 src/services/md5.ts 的独立实现
  md5Encode: (s: string) => md5(String(s)),
  random: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
};
```

- `new Function` 执行时注入 `java`、`key`、`page`、`result`、`source`、`baseUrl`、`node`、`doc`、`url` 参数。
- `source` 提供最小 `getVariable`（返回空串占位，供依赖它的书源不崩溃）。
- 返回任意 JS 值（不强制 String）——调用方按需转换。

## 4. @js: 接入点

### 4.1 searchUrl 构造

`parseSearchUrl` 增加：若 `searchUrl` 以 `@js:` 开头，调用 `evalJs` 构造 URL：

```ts
export function resolveSearchUrl(searchUrl: string, key: string, page: number): { url: string; method?: string; body?: string } {
  if (searchUrl.trim().startsWith("@js:")) {
    const url = String(evalJs(searchUrl.trim().slice(4), { doc: emptyDoc(), key, page, result: "" }));
    return { url };
  }
  return parseSearchUrl(searchUrl, key);
}
```
> `emptyDoc()` 用 `new DOMParser().parseFromString("", "text/html")` 构造空文档。

### 4.2 bookList 提取（核心）

`extractList` 增加 `@js:` 分支：`@js:` 返回数组（或可 parse 的 JSON 串）时，数组每项是一个对象，用 itemRules 的取值规则从对象取字段：

```ts
if (parsed.type === "js") {
  const raw = evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "" });
  const items = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
  return (items as any[]).map((item) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) {
      out[key] = extractFromJsObject(item, rule);
    }
    return out;
  });
}
```

`extractFromJsObject(obj, rule)`：从对象取字段，支持 legado 的 `$.field` 与 `field` 两种写法：

```ts
function extractFromJsObject(obj: any, rule: string): string {
  const s = rule.trim();
  if (!s) return "";
  const field = s.startsWith("$.") ? s.slice(2) : s;
  // 支持 bookUrl 等含 @js: 的规则：规则本身可能是 "@js:...@js:..." 拼接，简化处理
  if (s.startsWith("@js:")) {
    return String(evalJs(s.slice(4), { doc: emptyDoc(), result: obj }));
  }
  const v = obj[field];
  return v == null ? "" : String(v);
}
```

> 注意：bookUrl 规则可能是 `$.book_id@js:'http://...' + result`（如番茄书源）。`@js:` 混写在 `@` 后缀里。简化策略：若规则含 `@js:`，以 `@js:` 后的表达式执行，`result` 为该对象对应字段的值。此为启发式，先覆盖常见形式。

### 4.3 bookUrl / name / author / cover 取值

- 列表项来自 `@js:` 对象时，itemRules 通过 `extractFromJsObject` 取字段。
- `bookUrl` 若含 `@js:`，按 4.2 的 `@js:` 规则执行，`result` 为对象。

### 4.4 content 提取

`extractSingle` 已有 `js` 分支（返回 `evalJs(...)` 的 String）。扩展 `@js:` content 书源时，确保 `result` 传入抓取的 HTML/文本：

```ts
// 调用方（SourceReaderPage）抓取章节 HTML 后，若 ruleContent.content 是 @js:，
// 把 HTML 作为 result 传入 evalJs
```

## 5. CSP 放宽

`src-tauri/tauri.conf.json`：

```json
"csp": {
  ...
  "script-src": "'self' 'unsafe-eval'",
  ...
}
```

**安全说明**：`@js:` 书源代码由用户主动粘贴，视为可信。放宽后书源代码在 WebView 内可访问 `window.__TAURI_INTERNALS__.invoke`（等同本机命令调用权限）。风险可接受，作为设计决策记录。

## 6. 导入校验调整

`bookSourceImport.ts` 的 `validateBookSource` 当前**拒绝**含 `@js:` 的书源。本功能落地后改为**放行**（或移除该校验）。删除该校验及相关测试。

## 7. 测试

- `evalJs`：
  - 返回字符串
  - 返回数字/对象（不再强制 String）
  - `java.encodeURI` / `base64Decode` / `md5` / `regex`
  - 上下文变量 `key`/`page`/`result`/`source` 注入
  - 异常返回空/undefined（不崩溃）
- `resolveSearchUrl`：`@js:` 构造 URL
- `extractList` `@js:` 分支：数组/JSON 串 → 对象列表；`$.field` 与 `field` 取值；含 `@js:` 的 bookUrl
- `validateBookSource`：改为放行 `@js:` 书源
- 全量 `npm test` 保持绿

## 8. 交付文件

- `src/services/bookSourceEngine.ts`（evalJs 扩展、extractList @js: 分支、resolveSearchUrl、extractFromJsObject）
- `src/services/md5.ts`（新建，MD5 实现，供 java.md5/md5Encode）
- `src/services/bookSourceImport.ts`（移除 validateBookSource 的 @js: 拒绝）
- `src-tauri/tauri.conf.json`（CSP unsafe-eval）
- `src/pages/DiscoverPage.tsx` / `SourceReaderPage.tsx` / `SourceBookPage.tsx`（resolveSearchUrl 接入、content 的 result 传入）
- 测试文件（bookSourceEngine.test.ts、bookSourceImport.test.ts）
- `src/services/md5.ts`（若引入，md5 实现）

## 9. 已知限制

- 深度依赖 legado 特有 Java API（如 `source.getVariable`、复杂 `java.*` 方法）的书源可能不完整，按需补充。
- `@js:` 在 `bookUrl` 等字段的混写形式为启发式解析，部分书源可能不匹配。
- 全局 CSP 放宽后，所有书源代码在本机有命令调用权限（设计决策，记录在案）。
