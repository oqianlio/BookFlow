# 书源 JSON 规则提取（@Json: / $.）设计文档

日期：2026-08-13
状态：已批准
前置：已完成 legado 3.0 兼容书源引擎（CSS/XPath/正则/`@js:`/`||`/`tag.x`）、规则变量、jsLib + `@js:` exploreUrl、探索页、MD3 界面。

## 1. 目标

支持书源规则从 **JSON 响应**提取数据，兼容 legado 的 `@Json:` 前缀与 `$.` 路径语法。当前引擎只支持 HTML（CSS/XPath/正则/`@js:`），真实书源（如番茄聚合 API）大量使用 `@Json:data`、`$.book_name`、`$.book_id@js:...` 规则，导致探索/搜索/目录提取为空。

## 2. 非目标

- 不支持 `@Json:` 之外的 legado JSON 高级语法（如 `@Json:[*].field` 通配）。仅支持简单路径：`$.a.b`、`$[0]`、`$.a[0].b`。
- 不实现 legado 的 `isJSON` 自动嗅探（规则以 `[` 或 `{` 开头自动进 JSON 模式）——仅当规则显式以 `@Json:` 或 `$.`/`$[` 开头时走 JSON 分支。
- 不改动现有 HTML 提取行为。

## 3. 架构

```
parseRule 扩展：识别 JSON 模式
  "@Json:" 前缀 → { type: "json", value: 路径(去掉前缀) }
  "$." 或 "$[" 开头 → { type: "json", value: 规则原样 }

extractList / extractSingle:
  parsed.type === "json" → JSON 分支：
    json = JSON.parse(String(ctx.result ?? ""))     # 从原始响应解析
    列表: 按路径取数组 → 每项 { 各字段: jsonGet(item, fieldRule) }
    单值: 按路径取值 → 字符串（若规则含 @js: 后缀，先取值再 eval）

JSON 路径取值 jsonGet(obj, path):
  "$.a.b" / "a.b" / "$.a[0].b" → 逐段深入，返回最后值
  规则含 "@js:" 后缀 → 分割：路径部分取值 → 值作为 result 传给 evalJs
```

### 3.1 parseRule 扩展

```ts
if (s.startsWith("@Json:")) {
  return { type: "json", value: s.slice(7).trim() };
}
if (s.startsWith("$.") || s.startsWith("$[")) {
  return { type: "json", value: s };
}
```
（放在 `@js:` 判断之后、`##` 之前；注意 `$.` 判断要早于普通 CSS 分支。）

### 3.2 JSON 路径取值

新增纯函数 `jsonGet(obj: any, path: string): any`：

- 去掉开头的 `$.` / `$`。
- 按 `.` 或 `[...]` 分段（支持 `a.b`、`a[0]`、`a[0].c`）。
- 每段：若为数字索引 → 数组取；否则对象取键。
- 找不到 → `undefined`。

组合规则 `$.field@js:expr`：`extractFromJsonObject(obj, rule, ctx)` 先按路径取值（`@js:` 前的部分），把值作为 `result` 传给 `evalJs(expr)`，与现有 `extractFromJsObject` 的 `@js:` 处理一致。

### 3.3 extractList JSON 分支

```ts
if (parsed.type === "json") {
  let json: any;
  try { json = JSON.parse(String(ctx?.result ?? "")); } catch { return []; }
  const arr = jsonGet(json, parsed.value);
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) {
      out[key] = extractFromJsonObject(item, rule, { baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey });
    }
    return out;
  });
}
```

### 3.4 extractSingle JSON 分支

```ts
if (parsed.type === "json") {
  let json: any;
  try { json = JSON.parse(String(ctx?.result ?? "")); } catch { return ""; }
  const v = jsonGet(json, parsed.value);
  if (v == null) return "";
  return String(v);
}
```

### 3.5 extractFromJsonObject（字段级取值）

在 `extractFromJsObject` 基础上扩展为支持嵌套路径与 `@Json:` 前缀：

```ts
export function extractFromJsonObject(
  obj: any, rule: string,
  ctx?: { baseUrl?: string; sourceKey?: string },
): string {
  if (obj == null || typeof obj !== "object") return "";
  const s = rule.trim();
  if (!s) return "";
  const jsIdx = s.indexOf("@js:");
  const pathPart = (jsIdx > 0 ? s.slice(0, jsIdx) : s).trim();
  const path = pathPart.startsWith("@Json:")
    ? pathPart.slice(7).trim()
    : pathPart.replace(/^\$\.?/, "");
  const v = jsonGet(obj, path);
  if (jsIdx > 0) {
    return String(evalJs(s.slice(jsIdx + 4), { doc: emptyDoc(), result: v, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey }) ?? "");
  }
  if (v == null) return "";
  const str = String(v);
  const isUrlField = path.endsWith("bookUrl") || path.endsWith("coverUrl");
  if (isUrlField && ctx?.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(str)) return resolveUrl(str, ctx.baseUrl);
  return str;
}
```

`extractFromJsObject` 保留（`@js:` 列表的 item 仍用它，内部委托 jsonGet 以支持嵌套路径）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceEngine.ts` | parseRule 识别 @Json:/$.；新增 jsonGet；extractList/extractSingle 加 json 分支；extractFromJsonObject |
| `src/services/bookSourceEngine.test.ts` | 新增 JSON 提取测试 |

## 5. 测试

- `parseRule("@Json:data")` → `{ type: "json", value: "data" }`；`parseRule("$.a.b")` → json。
- `jsonGet({a:{b:[1,2]}}, "$.a.b[0]")` → 1；找不到 → undefined。
- `extractList(doc, "@Json:data", {...itemRules}, { result: JSON })` 提取书籍列表。
- `extractSingle(doc, "$.data.data.book_name", { result: JSON })` → 书名。
- 组合 `$.book_id@js:'http://x/detail?book_id=' + result` → 拼接 URL。
- `@Json:data@js:...` 组合：先取值数组再 eval 展平。
- JSON 解析失败 → 返回 []/"" 不抛错。
- 现有测试全绿。

## 6. 错误处理

- `JSON.parse` 失败 → 返回 `[]`（列表）/ `""`（单值），不抛错。
- 路径不存在 → `undefined` → 空。
- `@js:` eval 抛错 → evalJs 现有 catch 返回 `""`。
