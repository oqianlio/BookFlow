# 书源规则引擎 R14：legado `##` 替换规则兼容 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `extractFromElement`/`extractSingle` 支持 legado `##正则##替换` 后缀，修复分类页书籍列表提取抛 SyntaxError 的问题。

**Architecture:** ParsedRule 加 `replace` 字段；`splitReplaceSuffix` 拆分 `##` 链式替换；parseAttrRule 解析后填充；extractFromElement/extractSingle css 分支应用替换。

**Tech Stack:** TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 不改 purifyContent、不改 @js: 内替换、不改 jsBlock after 语义。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/bookSourceEngine.ts` | replace 拆分 + 应用 | 修改 |
| `src/services/bookSourceEngine.test.ts` | 替换测试 | 修改 |

## 任务依赖

Task 1（拆分）→ Task 2（应用）→ Task 3（测试）→ Task 4（验证）。

---

### Task 1: splitReplaceSuffix + parseAttrRule

**Files:**
- Modify: `src/services/bookSourceEngine.ts`

- [ ] **Step 1: ParsedRule 加 replace**

```ts
export type ParsedRule = {
  type: "css" | "regex" | "regexReplace" | "js" | "xpath" | "json" | "plain" | "jsBlock";
  value: string;
  attr?: string;
  after?: string;
  replace?: Array<[string, string]>;  // 新增
};
```

- [ ] **Step 2: splitReplaceSuffix**

```ts
function splitReplaceSuffix(s: string): { body: string; replaces: Array<[string, string]> } {
  const trimmed = s.trim();
  if (!trimmed.includes("##")) return { body: trimmed, replaces: [] };
  const parts = trimmed.split("##");
  if (parts.length < 3) return { body: trimmed, replaces: [] };
  const body = parts[0].trim();
  const replaces: Array<[string, string]> = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    replaces.push([parts[i], parts[i + 1]]);
  }
  return { body, replaces };
}
```

- [ ] **Step 3: parseAttrRule 接入**

```ts
function parseAttrRule(s: string): ParsedRule {
  const { body, replaces } = splitReplaceSuffix(s);
  if (body.startsWith("@")) {
    return { type: "css", value: "", attr: body.slice(1), replace: replaces.length ? replaces : undefined };
  }
  const m = body.match(/^(.+?)@([a-zA-Z]+)$/);
  if (m) {
    return { type: "css", value: m[1], attr: m[2], replace: replaces.length ? replaces : undefined };
  }
  return { type: "css", value: body, attr: "text", replace: replaces.length ? replaces : undefined };
}
```

注意：`##` 起始的顶层 regexReplace（`parseRule` L110 分支）不受影响——`splitReplaceSuffix("##a##b")` 会 body=""？`"##a##b".split("##")` = `["", "a", "b"]`，body=""。parseRule 的 `s.startsWith("##")` 分支先捕获（L110），不会走到 parseAttrRule。安全。

- [ ] **Step 4: tsc 通过**

Run: `npx tsc --noEmit`
Expected: 通过

---

### Task 2: 应用替换（extractFromElement + extractSingle）

**Files:**
- Modify: `src/services/bookSourceEngine.ts`

- [ ] **Step 1: applyReplacements 辅助**

```ts
function applyReplacements(v: string, replaces?: Array<[string, string]>): string {
  if (!replaces || !v) return v;
  let out = v;
  for (const [re, rep] of replaces) {
    if (!re) continue;
    try { out = out.replace(new RegExp(re, "g"), rep ?? ""); } catch { /* 非法正则，保留原值 */ }
  }
  return out;
}
```

- [ ] **Step 2: extractFromElement css 分支**

```ts
function extractFromElement(el: Element, rule: string, baseUrl?: string): string {
  const alts = splitAlternatives(rule);
  if (alts.length > 1) { ...不变... }
  const parsed = parseRule(rule);
  if (parsed.type !== "css") return "";
  if (!parsed.value) {
    return finalize(applyReplacements(nodeValue(el, parsed.attr), parsed.replace), parsed.attr, baseUrl);
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, el);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
  }
  const node = el.matches(parsed.value) ? el : el.querySelector(parsed.value);
  return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
}
```

- [ ] **Step 3: extractSingle css 路径**

`extractSingle` L279-280：

```ts
const node = doc.querySelector(parsed.value);
return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
```

以及 `tag.` 分支（L276-277）同样应用。xpath/json 分支的 attr 无 `##`（parseRule 顶层处理）——不涉及。

- [ ] **Step 4: tsc 通过**

Run: `npx tsc --noEmit`
Expected: 通过

---

### Task 3: 测试

**Files:**
- Modify: `src/services/bookSourceEngine.test.ts`

- [ ] **Step 1: 追加测试**

```ts
describe("legado ## replace rules", () => {
  it("parseAttrRule splits ## replacement suffix", () => {
    const r = parseRule(".author.0@text##作者：##");
    expect(r.type).toBe("css");
    expect(r.value).toBe(".author.0");
    expect(r.attr).toBe("text");
    expect(r.replace).toEqual([["作者：", ""]]);
  });

  it("extractList applies ## replacement via item rules", async () => {
    const html = `<div class="bookbox">
      <div class="bookname"><a href="/book/1.html">书一</a></div>
      <div class="author"><p>作者：刘慈欣</p></div>
    </div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      name: ".bookname a@text",
      author: ".author.0@text##作者：##",
      bookUrl: ".bookname a@href||.del_but@href",
    }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(1);
    expect(items[0].author).toBe("刘慈欣");
    expect(items[0].bookUrl).toBe("https://ex.com/book/1.html");
  });

  it("supports chained replacements", async () => {
    const html = `<div class="bookbox"><div class="bookname"><a href="/b/1.html">书一</a></div><div class="author">A|B</div></div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      author: ".author.0@text##\\|##、",
    }, { baseUrl: "https://ex.com" });
    expect(items[0].author).toBe("A、B");
  });

  it("ignores invalid replacement regex without throwing", async () => {
    const html = `<div class="bookbox"><div class="bookname"><a href="/b/1.html">书一</a></div><div class="author">作者：X</div></div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      author: ".author.0@text##[##",
    }, { baseUrl: "https://ex.com" });
    expect(items[0].author).toBe("作者：X");  // 非法正则保留原值
  });

  it("extractSingle css path applies replacement", async () => {
    const doc = parseHtml(`<html><body><div class="t">前缀内容</div></body></html>`);
    const v = await extractSingle(doc, ".t@text##前缀##");
    expect(v).toBe("内容");
  });
});
```

注意 `author: ".author.0@text##作者：##"` 的 `.author.0`——legado 的 `.class.0` 表示第 0 个匹配；我们的 `querySelector(".author.0")` 会因 `.0` 非法？看 resolveTagIndex 只处理 `tag.` 前缀。**`.author.0` 在 CSS 里是非法类名**（数字开头类名需要转义）。这是另一个兼容点！检查 nodeValue 的 attr 处理或 selectNodes 是否支持 `.class.0`：

Run: 先跑测试看 `.author.0` 是否报错；若报错，需在 extractFromElement 对 `.xxx.N` 后缀做 index 处理（legado 语义：取第 N 个匹配元素）。

**补充设计（若 .author.0 报错）**：extractFromElement 的 `el.querySelector(parsed.value)` 前，识别 `^(.+)\.(\d+)$` 且 body 是合法选择器——`.author.0` → 选择器 `.author` + index 0。改为：先 `el.querySelectorAll(baseSel)` 取第 N 个。

- [ ] **Step 2: 运行确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全绿（含新增）

- [ ] **Step 3: Commit**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: 规则引擎支持 legado ## 替换后缀（修复分类页提取抛错）"
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

- [ ] splitReplaceSuffix 拆分链式替换 ✓
- [ ] parseAttrRule 填充 replace ✓
- [ ] extractFromElement/extractSingle css 路径应用替换 ✓
- [ ] `.author.0` 类索引兼容（若需要）✓
- [ ] 新增 5 测试 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 替换规则终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 替换规则终审修复"
```

---
