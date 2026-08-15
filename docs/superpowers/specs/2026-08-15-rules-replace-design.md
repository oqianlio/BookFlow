# 书源规则引擎 R14：legado `##` 替换规则兼容

日期：2026-08-15
状态：待批准
前置：分类页书籍列表提取失败排查（用户"找不到书"）。

## 1. 目标

修复 `extractFromElement` 对 legado `##` 替换规则（`选择器@属性##正则##替换` / `文本##正则##替换`）的兼容：当前把整串当 CSS 选择器 → `querySelector` 抛 `SyntaxError: Invalid selector` → 分类页书籍列表提取抛异常 → 用户看到空列表。

## 2. 背景与问题

真实书源（如笔趣阁）的 `ruleExplore` 含：
- `"author": ".author.0@text##作者：##"`（取文本后去掉「作者：」前缀）
- `"bookUrl": ".bookname a@href||.del_but@href"`（`||` 交替）

`parseAttrRule` 正则 `/^(.+?)@([a-zA-Z]+)$/` 要求 `@` 后纯字母结尾，不识别 `##` 后缀 → `.author.0@text##作者：##` 整体当 CSS 选择器 → `el.matches()`/`querySelector()` 抛 SyntaxError。`extractList` 的 map 内抛错未被捕获 → 整个提取失败（ExplorePage catch → 空列表 + 错误弹窗）。

## 3. 非目标

- 不做 `@js:` 内的替换（evalJs 已有独立逻辑）。
- 不改 purifyContent（正文净化 `##` 规则已工作）。

## 4. 架构

```
parseAttrRule 扩展：
  先拆分 ## 后缀（正则 /##(.+?)##/ 或手动 split），剩余部分解析 css@attr；
  返回 ParsedRule 增加 after 字段存替换对 [regex, replacement]。

extractFromElement：
  css 分支提取值后，若 ParsedRule.after 存在 → 应用替换：
    try { value = value.replace(new RegExp(regex, "g"), replacement) } catch { /* 原值 */ }

extractSingle 的 css 路径同样受益（走 parseRule → parseAttrRule）。
```

### 4.1 ParsedRule 复用 after 字段

`ParsedRule` 已有 `after?: string`（jsBlock 用）。新增语义：css 规则带替换时 `after = "\u0001regex\u0001replacement"`？**不优雅**。改为给 ParsedRule 加 `replace?: [string, string]`（正则、替换串）。

```ts
export type ParsedRule = {
  type: ...;
  value: string;
  attr?: string;
  after?: string;      // jsBlock 的后续规则（现有）
  replace?: [string, string];  // 新增：## 替换对
};
```

### 4.2 parseAttrRule 拆分 ##

```ts
function parseAttrRule(s: string): ParsedRule {
  let body = s;
  let replace: [string, string] | undefined;
  // 提取 ##正则##替换 后缀（支持多个，最后一个生效——legado 语义取全部链式？原版支持多个，先支持一个+链式循环）
  const repMatch = s.match(/(?:^|(?<!^))##(.+?)##(.*)$/);  // 简化：找 ## 前缀
  ...
}
```

**legado 语义**：`规则##正则1##替换1##正则2##替换2` 链式替换。实现通用拆分：

```ts
function splitReplaceSuffix(s: string): { body: string; replaces: Array<[string, string]> } {
  const parts = s.split("##");
  // parts[0] = 提取规则体；之后每两个一组为 [regex, replacement]
  if (parts.length < 3) return { body: s, replaces: [] };
  const body = parts[0].trim();
  const replaces: Array<[string, string]> = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    replaces.push([parts[i], parts[i + 1]]);
  }
  // 奇数个 ## 段（最后一段无配对）→ 忽略最后一段（或视为替换为空）
  return { body, replaces };
}
```

**注意**：正文/文本本身可能含 `##`？替换正则含 `##` 罕见，接受此限制（legado 同款解析）。

### 4.3 extractFromElement 应用替换

```ts
function applyReplacements(v: string, replaces?: Array<[string, string]>): string {
  if (!replaces || !v) return v;
  let out = v;
  for (const [re, rep] of replaces) {
    if (!re) continue;
    try { out = out.replace(new RegExp(re, "g"), rep ?? ""); } catch { /* 原值 */ }
  }
  return out;
}
```

css 分支：`return finalize(applyReplacements(nodeValue(...), parsed.replace), attr, baseUrl)`。

### 4.4 extractSingle css 路径

`extractSingle` 的 `doc.querySelector(parsed.value)` 分支同样应用 `parsed.replace`（parseRule → parseAttrRule 已拆分）。`regexReplace` 顶层（`##正则##替换` 起始）保持不变。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceEngine.ts` | ParsedRule.replace + splitReplaceSuffix + parseAttrRule + extractFromElement/extractSingle 应用 |
| `src/services/bookSourceEngine.test.ts` | 替换规则测试 |

## 6. 测试

- parseAttrRule：`.author.0@text##作者：##` → value `.author.0` attr `text` replace `[["作者：",""]]`；无后缀原样。
- extractFromElement（经 extractList）：真实规则样例 `author: ".author.0@text##作者：##"` 提取后去除前缀；`bookUrl: ".bookname a@href||.del_but@href"` 交替取第一命中。
- extractSingle css 路径带替换。
- 链式替换（`##a##b##c##d`）。
- 非法正则不抛（原值）。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 非法正则 → 跳过该替换（原值）。
- `##` 段数不完整 → 忽略不配对段。
- 空 body（`##x##y` 起始）→ 仍走 regexReplace 顶层逻辑（不变）。
