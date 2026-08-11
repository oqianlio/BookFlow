# 书源探索分类 @js: 支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持书源 `exploreUrl` 以 `@js:` 开头（如 `@js:GEN_EXPLORE()`）动态生成分类，其中 `GEN_EXPLORE` 等函数定义在书源的 `jsLib` 字段（内联 JS）。

**Architecture:** 新增 `src/services/jsLib.ts` 提供会话级 jsLib 缓存（按 sourceKey）；`evalJs` 在执行表达式前先注入已缓存的 jsLib 代码（函数进入同一作用域）；`parseExploreUrl` 识别 `@js:` 前缀并支持 JSON 数组 / 字符串双格式解析；`ExplorePage` 打开书源时加载 jsLib。

**Tech Stack:** TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 仅支持内联 jsLib（JS 字符串），远程 URL jsLib 不加载（以 `http://`/`https://` 开头视为远程，跳过）。
- `parseExploreUrl(exploreUrl, ctx?)` 第二参为可选 `{ sourceKey?: string; source?: BookSource }`，缺省时行为与现状一致（纯文本按行解析）。
- `@js:` 返回空字符串 / eval 抛错 → 返回 `[]`，不抛错。
- 现有测试保持绿：`npm test`（当前 185），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/jsLib.ts` | jsLib 会话缓存 + loadJsLib/getJsLib | 新建 |
| `src/services/jsLib.test.ts` | jsLib 缓存测试 | 新建 |
| `src/services/bookSourceEngine.ts` | evalJs 注入 jsLib；parseExploreUrl 支持 @js: | 修改 |
| `src/services/bookSourceEngine.test.ts` | parseExploreUrl @js: 双格式测试 | 修改 |
| `src/pages/ExplorePage.tsx` | 打开书源时 loadJsLib + 传 ctx | 修改 |

## 任务依赖

Task 1（jsLib 缓存）→ Task 2（evalJs 注入 + parseExploreUrl @js:）→ Task 3（ExplorePage 接线）。

---

### Task 1: jsLib 会话缓存

**Files:**
- Create: `src/services/jsLib.ts`
- Test: `src/services/jsLib.test.ts`

**Interfaces:**
- Consumes: 无（纯模块）。
- Produces:
  ```ts
  export function loadJsLib(sourceKey: string, jsLib?: string): boolean;
  export function getJsLib(sourceKey: string): string;
  export function resetJsLib(sourceKey: string): void;
  ```
  - `loadJsLib`: jsLib 为空/空白或为远程 URL（`/^https?:\/\//i`）→ 返回 false，不缓存。否则缓存 `Map<sourceKey, jsLib>` 并返回 true。
  - `getJsLib`: 返回已缓存代码，无则 `""`。
  - `resetJsLib`: 删除该 sourceKey 缓存（供测试清理）。

- [ ] **Step 1: 写失败测试**

```ts
// src/services/jsLib.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadJsLib, getJsLib, resetJsLib } from "./jsLib";

describe("jsLib session cache", () => {
  beforeEach(() => { resetJsLib("a.com"); resetJsLib("b.com"); });

  it("caches inline jsLib and returns true", () => {
    expect(loadJsLib("a.com", "function GEN_EXPLORE(){ return 'x::/x'; }")).toBe(true);
    expect(getJsLib("a.com")).toContain("function GEN_EXPLORE");
  });

  it("skips empty jsLib", () => {
    expect(loadJsLib("a.com", "")).toBe(false);
    expect(loadJsLib("a.com", undefined)).toBe(false);
    expect(getJsLib("a.com")).toBe("");
  });

  it("skips remote URL jsLib", () => {
    expect(loadJsLib("a.com", "https://example.com/lib.js")).toBe(false);
    expect(loadJsLib("a.com", "http://example.com/lib.js")).toBe(false);
    expect(getJsLib("a.com")).toBe("");
  });

  it("isolates by sourceKey", () => {
    loadJsLib("a.com", "function F(){ return 1; }");
    expect(getJsLib("b.com")).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/jsLib.test.ts`
Expected: FAIL（`./jsLib` 不存在）

- [ ] **Step 3: 实现**

```ts
// src/services/jsLib.ts
const store = new Map<string, string>();
const REMOTE_URL_RE = /^https?:\/\//i;

export function loadJsLib(sourceKey: string, jsLib?: string): boolean {
  const code = jsLib?.trim() ?? "";
  if (!code || REMOTE_URL_RE.test(code)) return false;
  store.set(sourceKey, code);
  return true;
}

export function getJsLib(sourceKey: string): string {
  return store.get(sourceKey) ?? "";
}

export function resetJsLib(sourceKey: string): void {
  store.delete(sourceKey);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/jsLib.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/jsLib.ts src/services/jsLib.test.ts
git commit -m "feat: jsLib 会话缓存"
```

---

### Task 2: evalJs 注入 jsLib + parseExploreUrl 支持 @js:

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Test: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Consumes: `getJsLib`（Task 1）；`evalJs`/`emptyDoc`（现有）。
- Produces:
  - `parseExploreUrl(exploreUrl: string, ctx?: { sourceKey?: string; source?: any }): Array<{ title: string; url: string }>` — 扩展签名，`@js:` 双格式解析。
  - `evalJs` 内部：若 `ctx.sourceKey` 有 jsLib，则在函数体前注入 jsLib 代码。

- [ ] **Step 1: 写失败测试（追加到 bookSourceEngine.test.ts）**

在现有 `describe("parseExploreUrl")` 块内追加用例：

```ts
it("evaluates @js: expression with jsLib-defined function", () => {
  loadJsLib("ex.com", "function GEN_EXPLORE(){ return '玄幻::/x/\\n都市::/d/'; }");
  const r = parseExploreUrl("@js:GEN_EXPLORE()", { sourceKey: "ex.com" });
  expect(r).toEqual([
    { title: "玄幻", url: "/x/" },
    { title: "都市", url: "/d/" },
  ]);
});

it("parses @js: returning JSON array", () => {
  const r = parseExploreUrl('@js:[{"title":"玄幻","url":"/x/"},{"title":"都市","url":"/d/"}]', { sourceKey: "none" });
  expect(r).toEqual([
    { title: "玄幻", url: "/x/" },
    { title: "都市", url: "/d/" },
  ]);
});

it("parses @js: self-contained expression without jsLib", () => {
  const r = parseExploreUrl('@js:(()=>[{"title":"A","url":"/a/"}])()', {});
  expect(r).toEqual([{ title: "A", url: "/a/" }]);
});

it("returns empty array for failing @js: expression", () => {
  expect(parseExploreUrl("@js:null.x", {})).toEqual([]);
});
```

文件顶部 import 增加 `loadJsLib`：

```ts
import { ... loadJsLib } from "./jsLib";
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: FAIL（`@js:` 未被识别，返回 `[{title:"@js:GEN_EXPLORE()", url:"@js:GEN_EXPLORE()"}]` 之类）

- [ ] **Step 3: 实现**

**evalJs 注入 jsLib**（bookSourceEngine.ts:377 前，body 组装之后、`new Function` 之前）：

```ts
// 读取 jsLib 代码并前缀注入；剥离原 body 开头的 "use strict" 前缀避免重复
const jsLibCode = ctx.sourceKey ? getJsLib(ctx.sourceKey) : "";
if (jsLibCode) {
  const withoutStrict = body.replace(/^"use strict";\s*/, "");
  body = `"use strict";\n${jsLibCode}\n${withoutStrict}`;
}
```

说明：evalJs 的三个分支都以 `"use strict"; `（`\`"use strict"; ${code}...\``）开头；`/^"use strict";\s*/` 精确剥掉该前缀后，将 jsLib 代码插在 `"use strict";` 之后、原代码之前。函数定义（`function GEN_EXPLORE(){...}`）位于同一函数作用域顶部，后续表达式可直接调用。

**parseExploreUrl 支持 @js:**（bookSourceEngine.ts:413）：

```ts
export function parseExploreUrl(
  exploreUrl: string,
  ctx?: { sourceKey?: string; source?: any },
): Array<{ title: string; url: string }> {
  const s = exploreUrl.trim();
  if (s.startsWith("@js:")) {
    const expr = s.slice(4);
    const raw = evalJs(expr, {
      doc: emptyDoc(),
      result: "",
      sourceKey: ctx?.sourceKey,
      source: ctx?.source,
    });
    const str = String(raw ?? "").trim();
    if (!str) return [];
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            title: String(item?.title ?? item?.name ?? ""),
            url: String(item?.url ?? ""),
          }))
          .filter((k) => k.url);
      }
    } catch {
      // 非 JSON，走字符串解析
    }
    return str
      .split(/(&&|\n)+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf("::");
        if (idx === -1) return { title: line, url: line };
        return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
      });
  }
  return exploreUrl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("::");
      if (idx === -1) return { title: line, url: line };
      return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
    });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts src/services/jsLib.test.ts`
Expected: 全部 PASS（含既有 parseExploreUrl 用例——ctx 缺省时行为不变）

- [ ] **Step 5: 全量测试 + 构建**

Run: `npm test`（185 绿）；`npm run build` 通过。

- [ ] **Step 6: Commit**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: evalJs 注入 jsLib + 探索分类 @js: 双格式解析"
```

---

### Task 3: ExplorePage 接线

**Files:**
- Modify: `src/pages/ExplorePage.tsx`

**Interfaces:**
- Consumes: `loadJsLib`（Task 1）、`parseExploreUrl(exploreUrl, ctx)`（Task 2）。
- Produces: 无新接口。

- [ ] **Step 1: 接线**

`ExplorePage.tsx`：

```tsx
import { loadJsLib } from "../services/jsLib";
```

在打开书源成功的 effect 中（`setSrc(s)` 附近）：

```tsx
setSrc(s);
setCategories(parseExploreUrl(s.exploreUrl ?? "", { sourceKey: s.bookSourceUrl, source: s }));
loadJsLib(s.bookSourceUrl, s.jsLib);
```

同时更新 import 行：`parseExploreUrl` 已从 `../services/bookSourceEngine` 导入（保持），新增 `loadJsLib` 从 `../services/jsLib`。

注意：`BookSource` 类型（`../services/bookSourceEngine` 导出）需含可选 `jsLib?: string` 字段。若无，在 `bookSourceEngine.ts` 的 `BookSource` interface（约 20-29 行 `ruleExplore?: any;` 附近）追加 `jsLib?: string;`。

- [ ] **Step 2: 运行确认**

Run: `npm test` 全绿；`npm run build` 通过。

- [ ] **Step 3: Commit**

```bash
git add src/pages/ExplorePage.tsx src/services/bookSourceEngine.ts
git commit -m "feat: 探索页加载 jsLib 并传 ctx 解析分类"
```

---
