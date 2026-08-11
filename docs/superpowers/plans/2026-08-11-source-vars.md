# 子项目5：规则变量（java.put/get + source 变量）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「枕书」实现 legado 书源的规则变量：`evalJs` 的 `java.put/get` 与 `source.getVariable/putVariable`，session 级按书源 key 隔离。

**Architecture:** 新增 `src/services/sourceVars.ts`（模块级 `Map<sourceKey, Map<string,string>>`）；`JsContext` 加 `sourceKey`；`evalJs` 的 `java` 加 `put/get`，`source` 变量方法真正实现；各页面提取调用传 `sourceKey`。

**Tech Stack:** React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-11-source-vars-design.md`

## Global Constraints

- `java.put(k, v)` / `java.get(k)`：读写会话变量（值转字符串，缺省空串）。
- `source.getVariable()` / `source.putVariable(v)` / `source.setVariable(v)`：读写 "variable" 键。
- 变量按 `JsContext.sourceKey` 隔离；无 sourceKey 用 `"default"`。
- `TYPE()` 兼容（读 source.getVariable，split(",")[0] 语义不变）。
- 现有测试保持绿：`npm test`（156 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: sourceVars 存储 + evalJs 变量方法

**Files:**
- Create: `src/services/sourceVars.ts`
- Create: `src/services/sourceVars.test.ts`
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Produces:
  - `export function getSourceVars(sourceKey: string): Map<string, string>`
  - `export function resetSourceVars(sourceKey: string): void`
  - `JsContext` 增加 `sourceKey?: string`
  - `evalJs` 的 `java.put/get`；`source.getVariable/putVariable/setVariable` 实现

- [ ] **Step 1: 写失败的测试**

`src/services/sourceVars.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { getSourceVars, resetSourceVars } from "./sourceVars";

describe("sourceVars", () => {
  it("isolates vars per sourceKey", () => {
    const a = getSourceVars("sourceA");
    a.set("token", "abc");
    expect(getSourceVars("sourceB").get("token")).toBeUndefined();
    expect(getSourceVars("sourceA").get("token")).toBe("abc");
  });

  it("reset clears a source's vars", () => {
    const v = getSourceVars("sourceC");
    v.set("k", "1");
    resetSourceVars("sourceC");
    expect(getSourceVars("sourceC").get("k")).toBeUndefined();
  });
});
```

`src/services/bookSourceEngine.test.ts` 追加：
```ts
it("java.put/get roundtrips with sourceKey isolation", () => {
  const doc = emptyDoc();
  evalJs("java.put('page','2')", { doc, sourceKey: "ex.com" });
  expect(evalJs("java.get('page')", { doc, sourceKey: "ex.com" })).toBe("2");
  expect(evalJs("java.get('page')", { doc, sourceKey: "other.com" })).toBe("");
});

it("source.putVariable/getVariable persist across calls", () => {
  const doc = emptyDoc();
  evalJs("source.putVariable('3,foo')", { doc, sourceKey: "ex.com" });
  expect(evalJs("source.getVariable()", { doc, sourceKey: "ex.com" })).toBe("3,foo");
  expect(evalJs("source.getVariable()", { doc, sourceKey: "other.com" })).toBe("");
});

it("TYPE still works after source.getVariable implementation", () => {
  const doc = emptyDoc();
  evalJs("source.putVariable('1,x')", { doc, sourceKey: "ex.com" });
  expect(evalJs("TYPE()", { doc, sourceKey: "ex.com" })).toBe(2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/sourceVars.test.ts src/services/bookSourceEngine.test.ts`
Expected: FAIL（模块不存在 / java.put 不存在 / source.getVariable 返回占位）。

- [ ] **Step 3: 实现**

`src/services/sourceVars.ts`：
```ts
const store = new Map<string, Map<string, string>>();

export function getSourceVars(sourceKey: string): Map<string, string> {
  let vars = store.get(sourceKey);
  if (!vars) {
    vars = new Map();
    store.set(sourceKey, vars);
  }
  return vars;
}

export function resetSourceVars(sourceKey: string): void {
  store.delete(sourceKey);
}
```

`bookSourceEngine.ts`：
- `JsContext` 加 `sourceKey?: string`。
- `evalJs` 开头：
```ts
const vars = getSourceVars(ctx.sourceKey ?? "default");
```
- `java` 加：
```ts
put: (k: string, v: any) => { vars.set(String(k), String(v)); },
get: (k: string) => vars.get(String(k)) ?? "",
```
- source 变量（替换占位）：
```ts
source.getVariable = () => String(vars.get("variable") ?? "");
source.putVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
source.setVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
```
- import `getSourceVars`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/sourceVars.test.ts src/services/bookSourceEngine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/sourceVars.ts src/services/sourceVars.test.ts src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: 规则变量存储与 java.put/get"
```

---

### Task 2: 页面传 sourceKey

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`
- Modify: `src/pages/SourceBookPage.tsx`
- Modify: `src/pages/SourceReaderPage.tsx`
- Modify: `src/pages/ExplorePage.tsx`
- 测试：各页面已有测试确认不破坏（mock 返回固定书源 JSON，传 sourceKey 不影响断言）

**Interfaces:**
- Consumes: Task 1 `JsContext.sourceKey`；`extractList`/`extractSingle` 的 ctx 透传 sourceKey 到 evalJs
- Produces: 各页面提取调用（`extractSingle`/`extractList`）的 ctx 加 `sourceKey: <书源标识>`

- [ ] **Step 1: 实现（无新测试，现有测试保护）**

各页面提取调用 ctx 加 `sourceKey`：
- `DiscoverPage.tsx` searchSource：`extractList(doc, ..., { baseUrl, result: html, sourceKey: src.bookSourceUrl })`
- `SourceBookPage.tsx`：书籍/目录提取加 `sourceKey: s.bookSourceUrl`
- `SourceReaderPage.tsx` loadChapter：content 提取加 `sourceKey: src.bookSourceUrl`
- `ExplorePage.tsx`：分类书籍提取加 `sourceKey: src.bookSourceUrl`

> 注：`extractSingle`/`extractList` 的 ctx 需把 `sourceKey` 透传给 evalJs（js 分支）。Task 1 的 JsContext.sourceKey 已支持；ctx 类型（`{ baseUrl?, result?, sourceKey? }`）需在 Task 1 一并加。

- [ ] **Step 2: 运行测试确认通过**

Run: `npm test` 全量 + `npm run build`。
Expected: 全部 PASS（现有测试断言不受 sourceKey 影响）。

- [ ] **Step 3: 提交**

```bash
git add src/pages/
git commit -m "feat: 页面提取调用传 sourceKey"
```

---

## 已知限制（记录于 spec 附录）

- 变量 session 级（重启丢失），与 legado 一致。
- 变量按书源 key 隔离，跨书源不共享。
- `@put:`/`@get:` 独立前缀语法不支持（经 java.put/get 在 JS 内实现）。
