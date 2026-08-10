# @js: 书源支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在前端 JS 运行时模拟 legado 环境，支持 `@js:` 表达式执行，覆盖大多数 `@js:` 书源（搜索 URL 构造、列表提取、字段取值、正文提取）。

**Architecture:** 扩展 `bookSourceEngine.ts` 的 `evalJs`（注入 `java`/`key`/`page`/`result`/`source` 上下文，返回任意值），`extractList` 加 `@js:` 分支（数组/JSON 串 → 对象列表，`$.field` 取值），新增 `resolveSearchUrl` 支持 `@js:` URL 构造；CSP `script-src` 加 `'unsafe-eval'`；导入校验移除 `@js:` 拒绝。

**Tech Stack:** React + TS + Vitest, Tauri 2 (CSP config)

**Spec:** `docs/superpowers/specs/2026-08-10-js-source-support-design.md`

## Global Constraints

- CSP `script-src` 加 `'unsafe-eval'`（全局）。
- `evalJs(expr, ctx)` 返回任意 JS 值（不强制 String）。
- `extractList` 的 `@js:` 分支：返回数组或可 parse 的 JSON 串；每项用 `extractFromJsObject` 按 `$.field`/`field` 取值。
- `resolveSearchUrl(searchUrl, key, page)`：`@js:` 开头时用 `evalJs` 构造 URL。
- 导入校验 `validateBookSource` 移除对 `@js:`/`<js>` 的拒绝（放行）。
- 现有测试保持绿：`npm test`（88 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: `evalJs` 运行时扩展 + md5 工具

**Files:**
- Create: `src/services/md5.ts`
- Modify: `src/services/bookSourceEngine.ts`（evalJs 扩展 + JsContext）
- Modify: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Produces:
  - `export interface JsContext { node?: Element; doc: Document; result?: string; baseUrl?: string; key?: string; page?: number; source?: any }`
  - `export function evalJs(expr: string, ctx: JsContext): any` — 返回任意值；`java` 对象含 `encodeURI/decodeURI/base64Decode/base64Encode/regex/md5/md5Encode/random`；注入 `java,key,page,result,source,baseUrl,node,doc,url` 参数。
  - `export function emptyDoc(): Document`
  - `export function md5(s: string): string`（来自 `src/services/md5.ts`）

- [ ] **Step 1: 写失败的测试**

`src/services/md5.ts`（标准 MD5 实现，约 90 行，可在测试中验证已知向量）。

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { evalJs, emptyDoc } from "./bookSourceEngine";
import { md5 } from "./md5";

describe("evalJs extended", () => {
  const doc = emptyDoc();

  it("returns string value", () => {
    expect(evalJs("'hello'", { doc })).toBe("hello");
  });

  it("returns number without forcing String", () => {
    expect(evalJs("1 + 2", { doc })).toBe(3);
  });

  it("returns object/array value", () => {
    const r = evalJs("({a: 1})", { doc });
    expect(r).toEqual({ a: 1 });
  });

  it("injects key/page/result/source context", () => {
    const r = evalJs("key + ':' + page + ':' + result", { doc, key: "斗破", page: 2, result: "HTML" });
    expect(r).toBe("斗破:2:HTML");
  });

  it("java.encodeURI encodes", () => {
    expect(evalJs("java.encodeURI('你好')", { doc })).toBe(encodeURIComponent("你好"));
  });

  it("java.base64Decode decodes utf8", () => {
    expect(evalJs("java.base64Decode('5L2g5aW9')", { doc })).toBe("你好");
  });

  it("java.md5 hashes", () => {
    expect(evalJs("java.md5('abc')", { doc })).toBe(md5("abc"));
  });

  it("java.regex extracts group", () => {
    expect(evalJs("java.regex('id-123', 'id-(\\\\d+)')", { doc })).toBe("123");
  });

  it("returns empty string on exception, does not throw", () => {
    const r = evalJs("null.x", { doc });
    expect(r).toBeFalsy();
  });
});

describe("md5", () => {
  it("matches known vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `evalJs` 扩展断言 FAIL（当前返回 String、无 java.encodeURI 等）。

- [ ] **Step 3: 实现 md5.ts 与 evalJs 扩展**

`src/services/md5.ts`：标准 MD5（用广泛使用的公共域实现，`export function md5(input: string): string`）。

`bookSourceEngine.ts` 的 `evalJs` 替换为：
```ts
export function emptyDoc(): Document {
  return new DOMParser().parseFromString("", "text/html");
}

export interface JsContext {
  node?: Element;
  doc: Document;
  result?: string;
  baseUrl?: string;
  key?: string;
  page?: number;
  source?: any;
}

export function evalJs(expr: string, ctx: JsContext): any {
  const java = {
    encodeURI: (s: string) => encodeURIComponent(String(s)),
    decodeURI: (s: string) => decodeURIComponent(String(s)),
    base64Decode: (b64: string) =>
      new TextDecoder("utf-8").decode(Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0))),
    base64Encode: (s: string) => btoa(String(s)),
    regex: (input: string, pattern: string) => {
      const m = String(input).match(new RegExp(pattern));
      return m ? (m[1] ?? m[0]) : "";
    },
    md5: (s: string) => md5(String(s)),
    md5Encode: (s: string) => md5(String(s)),
    random: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
  };
  const source = ctx.source ?? {};
  const fn = new Function(
    "node", "doc", "result", "baseUrl", "key", "page", "source", "java", "url",
    `"use strict"; return (${expr});`,
  );
  try {
    return fn(ctx.node ?? null, ctx.doc, ctx.result ?? "", ctx.baseUrl ?? "", ctx.key ?? "", ctx.page ?? 1, source, java, ctx.baseUrl ?? "");
  } catch (e) {
    return "";
  }
}
```
> 注：`source` 提供最小 `getVariable`：`source.getVariable = () => ""`（在 `const source = ctx.source ?? {};` 后加 `if (!source.getVariable) source.getVariable = () => "";`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全部 PASS（含新增 evalJs/md5 断言）。

- [ ] **Step 5: 提交**

```bash
git add src/services/md5.ts src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: evalJs 运行时扩展与 md5 工具"
```

---

### Task 2: `extractList` @js: 分支 + 字段取值

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `evalJs`/`emptyDoc`/`JsContext`
- Produces:
  - `extractList(doc, listRule, itemRules, ctx?: { baseUrl?: string; result?: string })` — `ctx` 增加 `result`。
  - `export function extractFromJsObject(obj: any, rule: string, baseUrl?: string): string` — 支持 `$.field`/`field`；规则含 `@js:` 时执行，`result` 为该对象对应字段值。
  - `extractList` 的 `@js:` 分支：`evalJs(listRule 的表达式, { doc, baseUrl, result: ctx?.result })` 返回数组或 JSON 串 → 对象列表 → itemRules 映射。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { extractList, extractFromJsObject } from "./bookSourceEngine";

describe("extractList @js: branch", () => {
  const jsList = "@js:JSON.parse(result).data";
  const itemRules = { name: "$.book_name", author: "$.author", bookUrl: "$.book_id" };

  it("parses JSON array returned by @js:", () => {
    const doc = emptyDoc();
    const items = extractList(doc, jsList, itemRules, { result: JSON.stringify({ data: [
      { book_name: "三体", author: "刘慈欣", book_id: "1" },
      { book_name: "活着", author: "余华", book_id: "2" },
    ] }) });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("三体");
    expect(items[1].author).toBe("余华");
  });

  it("handles @js: returning an array directly", () => {
    const doc = emptyDoc();
    const items = extractList(doc, "@js:[{a:'x'},{a:'y'}]", { a: "$.a" }, {});
    expect(items.length).toBe(2);
    expect(items[0].a).toBe("x");
  });

  it("extractFromJsObject supports $.field and plain field", () => {
    expect(extractFromJsObject({ name: "N", id: 7 }, "$.name")).toBe("N");
    expect(extractFromJsObject({ name: "N", id: 7 }, "id")).toBe("7");
  });

  it("extractFromJsObject handles @js: rule with result as object", () => {
    const rule = "@js:'https://x.com/api/' + result.book_id";
    expect(extractFromJsObject({ book_id: "9" }, rule)).toBe("https://x.com/api/9");
  });

  it("extractFromJsObject returns empty for missing field", () => {
    expect(extractFromJsObject({ a: 1 }, "$.missing")).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `@js:` 分支当前返回 `[]`，新断言 FAIL。

- [ ] **Step 3: 实现**

`bookSourceEngine.ts`：
- `extractList` 签名 `ctx?: { baseUrl?: string; result?: string }`，`@js:` 分支：
```ts
if (parsed.type === "js") {
  const raw = evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "" });
  let items: any[];
  try {
    items = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
  } catch {
    items = [];
  }
  return (items as any[]).map((item) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromJsObject(item, rule, ctx?.baseUrl);
    return out;
  });
}
```
- `extractFromJsObject`：
```ts
export function extractFromJsObject(obj: any, rule: string, baseUrl?: string): string {
  const s = rule.trim();
  if (!s) return "";
  if (s.startsWith("@js:")) {
    return String(evalJs(s.slice(4), { doc: emptyDoc(), result: obj, baseUrl }) ?? "");
  }
  const field = s.startsWith("$.") ? s.slice(2) : s;
  const v = obj[field];
  if (v == null) return "";
  const str = String(v);
  if ((field === "bookUrl" || field === "coverUrl") && baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(str)) {
    return resolveUrl(str, baseUrl);
  }
  return str;
}
```
> 注：`extractList` 的 `@js:` 分支与现有 css/xpath 分支并列；`extractList` 开头需先处理 `||`（现有逻辑在 `parseRule` 前已拆 `||`，见 Task 2 既有实现）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: extractList @js: 分支与对象字段取值"
```

---

### Task 3: `resolveSearchUrl` + 页面接入

**Files:**
- Modify: `src/services/bookSourceEngine.ts`（resolveSearchUrl）
- Modify: `src/services/bookSourceEngine.test.ts`
- Modify: `src/pages/DiscoverPage.tsx`（searchSource 用 resolveSearchUrl + 传 result）
- Modify: `src/pages/SourceReaderPage.tsx`（content 的 @js: 传 result）
- Modify: `src/pages/SourceBookPage.tsx`（toc 的 extractList 传 result，若需）

**Interfaces:**
- Produces:
  - `export function resolveSearchUrl(searchUrl: string, key: string, page: number): { url: string; method?: string; body?: string }`
- Consumes: Task 1-2 全部

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { resolveSearchUrl } from "./bookSourceEngine";

describe("resolveSearchUrl", () => {
  it("handles @js: searchUrl", () => {
    const js = "@js:'https://x.com/api/search?key=' + java.encodeURI(key) + '&page=' + page";
    const r = resolveSearchUrl(js, "斗破", 1);
    expect(r.url).toBe("https://x.com/api/search?key=" + encodeURIComponent("斗破") + "&page=1");
  });

  it("falls back to plain parseSearchUrl for non-@js", () => {
    const r = resolveSearchUrl("https://x.com/search?q={{key}}", "三体", 1);
    expect(r.url).toBe("https://x.com/search?q=" + encodeURIComponent("三体"));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `resolveSearchUrl` 不存在 FAIL。

- [ ] **Step 3: 实现 resolveSearchUrl + 页面接入**

`bookSourceEngine.ts`：
```ts
export function resolveSearchUrl(searchUrl: string, key: string, page: number): { url: string; method?: string; body?: string } {
  const s = searchUrl.trim();
  if (s.startsWith("@js:")) {
    const url = String(evalJs(s.slice(4), { doc: emptyDoc(), key, page, result: "" }) ?? "");
    return { url };
  }
  return parseSearchUrl(searchUrl, key);
}
```

`DiscoverPage.tsx` `searchSource`：
```ts
const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1);
if (!parsed.url) return [];
const html = await httpGet(parsed.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, parsed.method, parsed.body);
const doc = parseHtml(html);
const rules = src.ruleSearch ?? {};
const itemRules: Record<string, string> = {};
for (const k of ["name", "author", "coverUrl", "bookUrl"] as const) if (rules[k]) itemRules[k] = rules[k];
const items = extractList(doc, rules.bookList ?? "", itemRules, { baseUrl: src.bookSourceUrl, result: html });
```
> 注：`result: html` 使 `@js:` bookList 脚本可用抓取的 HTML（`JSON.parse(result)` 等）。

`SourceReaderPage.tsx` `loadChapter`：
```ts
const text = extractSingle(doc, rules.content ?? "body", { baseUrl: c.url, result: html });
```
> 注：`extractSingle` 需支持 `ctx.result` 传给 `evalJs`（js 分支）。Task 2 未改 extractSingle 的 ctx；本任务补：`extractSingle` 的 `JsContext` 透传 `result`。

`SourceBookPage.tsx` toc：若 `ruleToc.chapterList` 为 `@js:`，`extractList(tocDoc, chapterList, {...}, { baseUrl: tocUrl, result: tocHtml })`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全部 PASS。跑 `npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts src/pages/
git commit -m "feat: resolveSearchUrl 与页面 @js: 接入"
```

---

### Task 4: CSP 放宽 + 导入校验放行

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/services/bookSourceImport.ts`
- Modify: `src/services/bookSourceImport.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: CSP `script-src` 含 `'unsafe-eval'`；`validateBookSource` 移除 `@js:` 拒绝（改为仅校验必填字段，或直接移除调用）。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceImport.test.ts`：
- 修改 `validateBookSource` 相关测试：删掉「rejects @js:」两条（Task 3 曾加），或改为断言 `@js:` 书源**通过**校验。
- 新增断言：
```ts
it("accepts @js: sources now", () => {
  const jsSrc = { bookSourceName: "X", bookSourceUrl: "https://x.com", searchUrl: "@js:var a=1;" };
  expect(() => extractBookSourceFromText(JSON.stringify(jsSrc))).not.toThrow();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceImport.test.ts`
Expected: 现有「rejects @js:」断言 FAIL（因为实现已放行）。

- [ ] **Step 3: 实现**

`bookSourceImport.ts`：
- 删除 `validateBookSource` 函数及 `extractBookSourceFromText` 内三处调用（或改为空操作）。

`tauri.conf.json`：
```json
"script-src": "'self' 'unsafe-eval'",
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceImport.test.ts`（更新后的断言 PASS）+ `npm test` 全量 + `cargo check`（CSP 配置生效验证）+ `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/tauri.conf.json src/services/bookSourceImport.ts src/services/bookSourceImport.test.ts
git commit -m "feat: CSP 放行 unsafe-eval 与 @js: 导入"
```

---

## 已知限制（记录于 spec 附录）

- 深度依赖 legado 特有 Java API（`source.getVariable`、复杂 `java.*`）的书源可能不完整。
- `@js:` 在 `bookUrl` 等字段的混写形式为启发式解析。
- 全局 CSP 放宽后书源代码在本机有命令调用权限（设计决策，记录在案）。
