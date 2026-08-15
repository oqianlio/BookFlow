# 书源规则引擎 R15：裸 XPath 与链式 @ 元素规则兼容 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** parseRule 识别裸 XPath 与大写 @XPath:；extractList 支持链式 `A@B@C` 元素规则（含类索引段）。

**Architecture:** parseRule 加 XPath 识别；extractList css 分支前加链式解析（每段 queryIndexed）。

**Tech Stack:** TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 不做负索引、不做 item 内链式（本批）。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/bookSourceEngine.ts` | XPath 识别 + 链式解析 | 修改 |
| `src/services/bookSourceEngine.test.ts` | 测试 | 修改 |

## 任务依赖

Task 1（XPath 识别）→ Task 2（链式解析）→ Task 3（测试）→ Task 4（验证）。

---

### Task 1: parseRule XPath 识别

**Files:**
- Modify: `src/services/bookSourceEngine.ts`

- [ ] **Step 1: 加裸 XPath 与大小写不敏感 @xpath:**

```ts
// parseRule 内，@css: 之前或之后加：
if (s.startsWith("//") || s.startsWith("(//")) {
  return { type: "xpath", value: s };
}
```

- @xpath: 大小写不敏感：

```ts
if (s.toLowerCase().startsWith("@xpath:")) {
  return { type: "xpath", value: s.slice(7) };
}
```

**注意顺序**：`@xpath:` 检查要放在 `@css:` 等之前？现有代码 `if (s.startsWith("@css:"))` 在前。`@XPath:` 大写不会命中 `@css:`。把 XPath 检查放 `@css:` 之前（含大小写）稳妥。

- [ ] **Step 2: tsc 通过**

Run: `npx tsc --noEmit`

---

### Task 2: extractList 链式解析

**Files:**
- Modify: `src/services/bookSourceEngine.ts`

- [ ] **Step 1: css 分支前加链式**

extractList 结构：xpath → js → json → jsBlock → css。在 `if (parsed.type !== "css") return [];` 之后、`selectNodes` 之前加：

```ts
const chain = parsed.value.split("@").filter(Boolean);
if (chain.length > 1) {
  let nodes: Element[] = selectNodes(doc, chain[0]);
  for (let i = 1; i < chain.length && nodes.length > 0; i++) {
    const next: Element[] = [];
    for (const n of nodes) {
      const hit = queryIndexed(chain[i], n);
      if (hit) next.push(hit);
    }
    nodes = next;
  }
  return nodes.map((node) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule, ctx?.baseUrl);
    return out;
  });
}
```

注意：`parsed.value` 可能含 `##` 替换（splitReplaceSuffix 已拆走，parsed.value 是 body）——链式基于 body。`@css:xx@yy` 场景：parseRule 对 `@css:` 前缀会 slice 后 parseAttrRule——`@css:.a@li` → parseAttrRule(".a@li") → 正则 `^(.+?)@([a-zA-Z]+)$` 匹配 `.a@li`？`li` 是字母 → value=".a" attr="li"。**这会被误判为属性**！链式应基于未拆属性的原始 value。

**修正**：链式解析应在 parseRule 之前（基于原始规则字符串），或 parseAttrRule 对含多个 `@` 的规则不按属性解析。**方案**：extractList 开头（parseRule 前）检查：

```ts
// 链式元素规则（A@B@C，含多个 @ 且非属性/非 xpath/json）
const isChain = (rule: string) => {
  const t = rule.trim();
  if (t.startsWith("@") || t.startsWith("//") || t.startsWith("$")) return false;
  const parts = t.split("@");
  return parts.length > 2 || (parts.length === 2 && !/^[a-zA-Z]+$/.test(parts[1].trim()));
};
```

但 `parseRule` 已经把 `.clearfix.1@li@a` 解析成 value=".clearfix.1@li" attr="a"？看正则：`^(.+?)@([a-zA-Z]+)$` 对 `.clearfix.1@li@a`——懒惰匹配 `.+?` 会尝试最短，`([a-zA-Z]+)$` 匹配尾部 `a`，`(.+?)` = `.clearfix.1@li`。所以 parsed.value = `.clearfix.1@li`，attr = `a`。

**方案修正**：extractList 的 css 分支，当 `parsed.attr` 存在但 parsed.value 含 `@` 时（说明是链式而非属性）→ 用 parsed.value 拆链。但 attr="a" 是最终属性？`.clearfix.1@li@a` 的 `a` 是元素标签不是属性！**legado 语义**：`.clearfix.1@li@a` 全链是元素选择，取最后的 `a` 元素（text）。若还有 `@text` 才取属性。

**简化且正确的处理**：在 extractList 开头（parseRule 前）对整条 chapterList 规则做链式识别。若含 `@` 且不是 xpath/json/js/纯属性 → 走链式：

```ts
export async function extractList(doc, listRule, itemRules, ctx) {
  const trimmed = listRule.trim();
  // 链式元素规则：含 @ 且非已知前缀
  const looksChain = trimmed.includes("@") && !trimmed.startsWith("@") && !trimmed.startsWith("//") && !trimmed.startsWith("$");
  if (looksChain) {
    const chain = trimmed.split("@").map(s => s.trim()).filter(Boolean);
    if (chain.length > 1) {
      let nodes: Element[] = selectNodes(doc, chain[0]);
      for (let i = 1; i < chain.length && nodes.length; i++) {
        const next: Element[] = [];
        for (const n of nodes) {
          const hit = queryIndexed(chain[i], n);
          if (hit) next.push(hit);
        }
        nodes = next;
      }
      return nodes.map((node) => {
        const out: Record<string, string> = {};
        for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule, ctx?.baseUrl);
        return out;
      });
    }
  }
  // ...原有 parseRule 流程
}
```

`selectNodes` 对 `.clearfix.1` 会抛错（非法选择器）——需要 queryIndexed 版本。改链式首段用 queryIndexed：

```ts
let first: Element[] = [];
const f0 = queryIndexed(chain[0], doc);
if (f0) first.push(f0);
else first = [];
```

queryIndexed 对 Document 支持 querySelectorAll。用 selectNodes 兼容 Document：

```ts
let nodes: Element[] = selectNodesCompat(chain[0], doc);  // 内部 try querySelectorAll 失败 → queryIndexed
```

**简化**：写 `selectNodesSafe(sel, scope)` = try querySelectorAll，失败用 queryIndexed 包装（取单节点数组）。

- [ ] **Step 2: tsc 通过**

Run: `npx tsc --noEmit`

---

### Task 3: 测试

**Files:**
- Modify: `src/services/bookSourceEngine.test.ts`

- [ ] **Step 1: 追加测试**

```ts
describe("legado xpath and chain element rules", () => {
  it("parseRule recognizes bare XPath", () => {
    const r = parseRule("//*[@id='allchapter']//dd[a]");
    expect(r.type).toBe("xpath");
    expect(parseRule("@XPath:.//a/text()").type).toBe("xpath");
  });

  it("extractList handles bare XPath chapterList", async () => {
    const html = `<html><body><div id="allchapter"><dd><a href="/c/1.html">第一章</a></dd><dd><a href="/c/2.html">第二章</a></dd></div></body></html>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, "//*[@id='allchapter']//dd[a]", {
      name: "@XPath:.//a/text()", url: "@XPath:.//a/@href",
    }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("第一章");
    expect(items[0].url).toBe("https://ex.com/c/1.html");
  });

  it("extractList handles chained @ element rules with class index", async () => {
    const html = `<div class="clearfix"><ul><li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ul></div><div class="clearfix"><ul><li><a href="/x/9.html">X章</a></li></ul></div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".clearfix.1@li@a", { name: "text", url: "href" }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("第一章");
    expect(items[0].url).toBe("https://ex.com/c/1.html");
  });
});
```

- [ ] **Step 2: 运行确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全绿（含新增 3）

- [ ] **Step 3: Commit**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: 规则引擎支持裸 XPath 与链式 @ 元素规则（修复目录提取）"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] parseRule 裸 XPath / @XPath: 大写 ✓
- [ ] extractList 链式 @ 元素规则（含类索引段）✓
- [ ] 新增 3 测试 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: XPath 链式终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: XPath 链式终审修复"
```

---
