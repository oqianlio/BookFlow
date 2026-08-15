# 书源规则引擎 R15：裸 XPath 与链式 @ 元素规则兼容

日期：2026-08-15
状态：待批准
前置：R14 替换规则修复后，目录提取仍失败（用户"看不到目录"）。

## 1. 目标

修复目录（ruleToc）提取失败的两种 legado 规则语法：
1. **裸 XPath**（`chapterList: "//*[@id='allchapter']//dd[a]"`）：`//` 开头未识别为 XPath，被当 CSS 选择器 → `querySelectorAll` 抛 SyntaxError。
2. **链式 `@` 元素规则**（`chapterList: ".clearfix.1@li@a"`）：`A@B@C` 表示 A 选节点 → 其内选 B → 其内选 C，当前整串当选择器抛错。

## 2. 背景与问题

真实书源目录规则：
- 思兔阅读：`chapterList: "//*[@id='allchapter']//dd[a]"`（裸 XPath，无 `@xpath:` 前缀）
- 全本同人小说网：`chapterList: ".clearfix.1@li@a"`（链式 @，含类索引）
- 备注：`chapterName: "@XPath:.//a/text()"` 大写 `@XPath:` 前缀也未识别（parseRule 只认小写 `@xpath:`）

三者都导致 `extractList` 抛 SyntaxError → 目录空。

## 3. 非目标

- 不做 `@js:` 链式（evalJs 已有）。
- 不做 `text##...##` 之外的替换扩展。
- 不做 `[-1]` 负索引（`class.recommend[-1]`）——暂缺，后续。

## 4. 架构

### 4.1 parseRule 识别裸 XPath

```ts
if (s.startsWith("//") || s.startsWith("(//")) {
  return { type: "xpath", value: s };
}
```

extractList 已有 xpath 分支（`doc.evaluate(parsed.value, ...)`），接入即生效。

### 4.2 大写 @XPath: 前缀

```ts
if (s.toLowerCase().startsWith("@xpath:")) {
  return { type: "xpath", value: s.slice(7) };
}
```

### 4.3 链式 @ 元素规则（extractList chapterList）

`extractList` 的 css 分支：`parsed.value` 若含 `@`（非属性后缀场景）→ 链式解析。

```ts
// 在 extractList 的 css 分支前：
const chain = parsed.value.split("@").filter(Boolean);
if (chain.length > 1) {
  // 链式：第一个是根选择器，后续依次在节点内查
  let nodes: Element[] = selectNodes(doc, chain[0]);
  for (let i = 1; i < chain.length && nodes.length; i++) {
    const next: Element[] = [];
    for (const n of nodes) {
      // 每段支持 .class.N 索引（queryIndexed）
      const hit = queryIndexed(chain[i], n);
      if (hit) next.push(hit);
    }
    nodes = next;
  }
  return nodes.map((node) => { ...itemRules 提取... });
}
```

**注意**：`.clearfix.1@li@a` 的 `.clearfix.1` 用 queryIndexed（类索引），`li`/`a` 用 querySelector。链式每段都走 queryIndexed。

### 4.4 extractFromElement 链式（可选）

item 规则如 chapterName 的 `"text"`/`"href"` 是纯属性，无链式。链式主要用于 chapterList（list 规则）。**本批 extractFromElement 不加链式**（list 规则已覆盖主要场景；若后续遇到 item 内链式再加）。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceEngine.ts` | parseRule XPath 识别 + extractList 链式 |
| `src/services/bookSourceEngine.test.ts` | 裸 XPath/链式/大写前缀测试 |

## 6. 测试

- parseRule：`//*[@id='x']//dd` → xpath；`@XPath:.//a/text()` → xpath。
- extractList：裸 XPath chapterList 提取目录；链式 `.clearfix.1@li@a` 提取；链式含类索引。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 链式某段无匹配 → 该节点跳过（nodes 过滤）。
- XPath 求值失败 → 空列表（现有 xpath 分支由调用方处理）。
