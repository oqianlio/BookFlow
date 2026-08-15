# `<js>` 内嵌块 + java.ajax 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持书源规则的 `<js>...</js>` 内嵌 JS 块与 `java.ajax`（ajax 响应作为后续 CSS 提取上下文）。核心：extract 系列改 async。

**Architecture:** `parseRule` 识别 `<js>...</js>` → `{ type: "jsBlock", value, after }`；`evalJs` 注入 `java.ajax`（同步记录 URL 到 ctx._ajaxUrl）；`extractSingle`/`extractList`/`extractBookList` 改 async，jsBlock 分支 await httpGet 拿 ajax 响应后递归提取 after 部分；页面调用点加 await。

**Tech Stack:** TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 现有测试保持绿：`npm test`（当前 226），`npm run build`（tsc + vite）通过。
- 不修改 docs/、.git/。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/bookSourceEngine.ts` | parseRule jsBlock、java.ajax、async 化 extract 系列 | 修改 |
| `src/services/bookSourceEngine.test.ts` | 测试加 await + 新增 <js> 用例 | 修改 |
| `src/pages/DiscoverPage.tsx` | extractBookList await | 修改 |
| `src/pages/ExplorePage.tsx` | extractBookList await | 修改 |
| `src/pages/ReaderPage.tsx` | extractSingle await | 修改 |
| `src/pages/SourceBookPage.tsx` | extractSingle/extractList await | 修改 |
| `src/services/sourceDebug.ts` | extractSingle/extractList await | 修改 |

## 任务依赖

Task 1（引擎 async 化 + jsBlock + java.ajax）→ Task 2（页面 await + 测试迁移）。

---

### Task 1: 引擎 async 化 + jsBlock

**Files:**
- Modify: `src/services/bookSourceEngine.ts`

**Interfaces:**
- Consumes: `httpGet`/`mergeUserAgent` from `./api`（现有）；`parseHtml`/`emptyDoc`/`evalJs`（现有）。
- Produces:
  - `ParsedRule.type` 加 `"jsBlock"`。
  - `extractSingle(doc, rule, ctx): Promise<string>`。
  - `extractList(doc, listRule, itemRules, ctx): Promise<Array<Record<string,string>>>`。
  - `extractBookList(doc, rules, ctx): Promise<Array<Record<string,string>>>`。
  - `JsContext` 加 `source?: any; cookieHost?: string`。
  - `evalJs` java 注入 `ajax`（记录 URL 到 ctx._ajaxUrl）。

- [ ] **Step 1: 写失败测试（追加到 bookSourceEngine.test.ts，先红）**

```ts
import { parseHtml, parseRule, extractSingle, extractBookList } from "./bookSourceEngine";
import * as api from "./api";

describe("jsBlock <js> rule", () => {
  it("parses <js> block into jsBlock type with after", () => {
    const r = parseRule("<js>var a=1;</js>class.intro.0@html");
    expect(r).toEqual({ type: "jsBlock", value: "var a=1;", after: "class.intro.0@html" });
  });

  it("extractSingle with jsBlock uses java.ajax response as context", async () => {
    const spy = vi.spyOn(api, "httpGet").mockResolvedValue(`<html><body><div class="intro"><p>简介内容</p></div></body></html>`);
    const doc = parseHtml("<html></html>");
    const out = await extractSingle(doc, "<js>p='https://x.com/detail'; java.ajax(p)</js>class.intro.0@html", {
      sourceKey: "x", source: { bookSourceUrl: "https://x.com", httpHeaders: {}, httpUserAgent: "UA" }, cookieHost: "x.com",
    });
    expect(spy).toHaveBeenCalledWith("https://x.com/detail", expect.anything(), undefined, undefined, undefined, undefined, "x.com");
    expect(out).toBe("简介内容");
  });

  it("extractSingle with jsBlock without ajax uses original doc", async () => {
    const doc = parseHtml(`<html><body><div class="intro"><p>原内容</p></div></body></html>`);
    const out = await extractSingle(doc, "<js>var x=1;</js>class.intro.0@html", { sourceKey: "x" });
    expect(out).toBe("原内容");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: FAIL（jsBlock 类型/async 未实现）

- [ ] **Step 3: parseRule 加 jsBlock**

`ParsedRule` 类型加 `"jsBlock"`；`parseRule` 在 `@js:` 之后、`##` 之前插入：

```ts
if (s.startsWith("<js>")) {
  const end = s.indexOf("</js>");
  if (end !== -1) {
    return { type: "jsBlock", value: s.slice(4, end), after: s.slice(end + 5).trim() };
  }
}
```

- [ ] **Step 4: evalJs java.ajax**

在 `evalJs` 的 `java` 对象加 `ajax`：

```ts
ajax: (url: any) => { (ctx as any)._ajaxUrl = String(url ?? ""); return ""; },
```

- [ ] **Step 5: async 化 extract 系列**

- `JsContext` 加 `source?: any; cookieHost?: string`。
- `extractSingle`、`extractList`、`extractBookList` 加 `async` 关键字。
- `extractSingle` 加 jsBlock 分支（在 json 分支之后）：

```ts
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source };
    evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as any)._ajaxUrl as string | undefined;
    let doc = ctx?.doc ?? emptyDoc();
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const host = ctx?.cookieHost ?? "";
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, host);
      doc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractSingle(doc, parsed.after, newCtx);
  }
```

- `extractList` 加 jsBlock 分支（同样逻辑，但 after 走 extractList）：

```ts
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source };
    evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as any)._ajaxUrl as string | undefined;
    let doc = ctx?.doc ?? emptyDoc();
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, ctx?.cookieHost ?? "");
      doc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractList(doc, parsed.after, itemRules, newCtx);
  }
```

- 内部调用点加 await：`extractSingle` 内 `const v = extractSingle(doc, alt, ctx)` → `const v = await extractSingle(...)`；`extractList` 内 item 提取 `extractFromElement`/`extractFromJsonObject`/`extractFromJsObject`（这些是同步辅助，保持同步，但主 async 函数返回时 TS 自动包装）；`extractBookList` 内 `extractList(...)` → `await extractList(...)`。
- 其余 `extractSingle` 返回改为 `return extractSingle(doc, parsed.after, newCtx)`（jsBlock 递归）与其他分支的同步 return 混用时，TS 允许（async 函数返回 Promise）。注意 `if (v) return v` 等需 await。

- [ ] **Step 6: 编译验证**

Run: `npx tsc --noEmit` — 引擎无错误（测试文件的红是 Task 2 迁移）。
注：页面调用点此时会红（extract 返回 Promise，页面没 await）——Task 2 处理。

- [ ] **Step 7: Commit**

```bash
git add src/services/bookSourceEngine.ts
git commit -m "feat: 规则引擎 async 化 + <js> 块 + java.ajax"
```

---

### Task 2: 页面 await + 测试迁移

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`、`ExplorePage.tsx`、`ReaderPage.tsx`、`SourceBookPage.tsx`、`src/services/sourceDebug.ts`
- Modify: `src/services/bookSourceEngine.test.ts`（加 await）

**Interfaces:**
- Consumes: Task 1 的 async extract 系列。

- [ ] **Step 1: 页面调用点加 await**

| 位置 | 改 |
|---|---|
| `DiscoverPage.tsx:20` | `const items = extractBookList(...)` → `const items = await extractBookList(...)` |
| `ExplorePage.tsx:48` | 同 await |
| `ReaderPage.tsx:85` | `const text = extractSingle(...)` → `await` |
| `ReaderPage.tsx:87` | 同（若书源 content 提取） |
| `SourceBookPage.tsx:34-39` | 各 extractSingle → await |
| `SourceBookPage.tsx:45` | extractList → await |
| `sourceDebug.ts` | 各 extractSingle/extractList → await |

注意 `SourceBookPage.tsx:34-37` 的 `bi.name ? extractSingle(...) : initialTitle` 三元需改为先提取再三元或 `await` 包裹。

- [ ] **Step 2: 测试加 await + 新增 jsBlock 用例**

`bookSourceEngine.test.ts`：所有 `extractSingle(...)`/`extractList(...)`/`extractBookList(...)` 断言前加 `await`。文件顶部 import 加 `parseRule`、`httpGet` mock（现有 vi.mock 已有 api）。追加 Step 1 的 3 个 jsBlock 测试。

- [ ] **Step 3: 运行测试 + 构建**

Run: `npm test` 全绿（226 + 3 新增）；`npm run build` 通过。

- [ ] **Step 4: 终审清单**

- [ ] `parseRule` 识别 `<js>...</js>` ✓
- [ ] `java.ajax` 记录 URL（同步）✓
- [ ] extractSingle/extractList/extractBookList async ✓
- [ ] jsBlock 分支：ajax 响应作为新 doc，after 递归提取 ✓
- [ ] 页面调用点 await ✓
- [ ] 测试 await + 新增 jsBlock 用例 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: <js> 终审修复`）。

- [ ] **Step 5: Commit**

```bash
git add src/pages/DiscoverPage.tsx src/pages/ExplorePage.tsx src/pages/ReaderPage.tsx src/pages/SourceBookPage.tsx src/services/sourceDebug.ts src/services/bookSourceEngine.test.ts
git commit -m "test: 页面 await + jsBlock 用例"
```

---
