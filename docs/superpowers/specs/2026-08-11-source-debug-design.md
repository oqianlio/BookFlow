# 子项目6：书源调试器设计文档

日期：2026-08-11
状态：已批准

## 1. 背景与目标

用户排查书源问题时，需要直观看到「给定一个 URL/关键词，书源规则每一步提取到什么」。为对齐 legado 3.0 的调试规则功能，本子项目实现书源调试器：书源管理里对每个书源提供调试入口，运行搜索/目录/正文等阶段，分步显示各规则字段的提取结果。

**参考**：legado-md3 `BookSourceDebugScreen`/`BookSourceDebugViewModel`（URL 输入 + 分阶段运行 + 分字段结果）。

## 2. 非目标

- 不实现 WebSocket 远程调试（legado 的 `BookSourceDebugWebSocket`）。
- 不实现规则在线编辑（仅调试查看）。
- 不做断点/单步执行（显示各阶段结果即可）。

## 3. 技术架构

```
BookSourceManager → 书源「调试」按钮 → DebugSourcePage(sourceId)
  ├─ 输入：URL（搜索阶段可选关键词）
  ├─ 选择阶段：搜索 / 目录 / 正文
  ├─ 运行：复用 httpGet + 书源规则（extractSingle/extractList）
  └─ 输出：抓取的 HTML 摘要 + 每规则字段提取结果（逐行显示）
```

- 复用现有引擎与 `httpGet`（含 cookieJar、sourceKey）。
- 阶段映射：
  - 搜索：用 `resolveSearchUrl` + `ruleSearch`，输入关键词。
  - 目录：URL 为书籍页 → `ruleBookInfo` + `ruleToc`。
  - 正文：URL 为章节页 → `ruleContent`。

## 4. 文件改动

- **新建 `src/pages/DebugSourcePage.tsx`**：
  - Props: `{ sourceId: number; sourceName: string; onBack: () => void }`。
  - 输入：URL 文本框 + 阶段选择（搜索/目录/正文）+ 关键词（仅搜索）。
  - 运行：抓取 URL → 解析 HTML → 按阶段提取 → 显示「HTML 摘要」+ 每字段结果列表（字段名 + 截断值）。
  - 错误显示 + 重试。
- **新建 `src/services/sourceDebug.ts`**（纯逻辑，可测）：
  - `export interface DebugResult { html: string; fields: Array<{ name: string; value: string }> }`
  - `export async function debugSource(bs: BookSource, stage: "search" | "toc" | "content", urlOrKey: string, key?: string): Promise<DebugResult>` — 运行对应阶段规则，返回 HTML 摘要 + 各字段提取结果。
- **修改 `src/components/BookSourceManager.tsx`**：每个书源加「调试」按钮 → 传入 onDebug(sourceId, sourceName)。
- **修改 `src/App.tsx`**：新增 `debugSource` view。
- **CSS**：调试结果列表样式。

## 5. debugSource 逻辑

```ts
export async function debugSource(bs, stage, urlOrKey, key) {
  const src = parseBookSourceJson(bs.json);
  const ua = mergeUserAgent(src.httpHeaders, src.httpUserAgent);
  const host = new URL(src.bookSourceUrl).hostname;
  let url = urlOrKey;
  let html: string;
  if (stage === "search") {
    const parsed = resolveSearchUrl(src.searchUrl ?? "", urlOrKey, 1, { sourceKey: src.bookSourceUrl });
    url = parsed.url; html = await httpGet(url, ua, undefined, parsed.method, parsed.body, undefined, host);
  } else {
    html = await httpGet(url, ua, undefined, undefined, undefined, undefined, host);
  }
  const doc = parseHtml(html);
  const fields: Array<{ name: string; value: string }> = [];
  if (stage === "search") {
    for (const k of ["bookList", "name", "author", "coverUrl", "bookUrl"]) {
      const rule = src.ruleSearch?.[k];
      if (!rule) continue;
      const v = k === "bookList" ? JSON.stringify(extractList(doc, rule, { name: "a@text", author: "a@text", bookUrl: "a@href" }, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl })).slice(0, 200) : extractSingle(doc, rule, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl });
      fields.push({ name: k, value: v });
    }
  }
  // toc: ruleBookInfo 字段 + ruleToc 字段
  // content: ruleContent.content/nextContentUrl
  return { html: html.slice(0, 500), fields };
}
```
> 简化：各阶段字段提取用对应规则；列表字段截断展示。

## 6. 测试

- `sourceDebug.test.ts`：mock httpGet，验证搜索/目录/正文阶段返回对应字段（用固定书源 JSON + HTML fixture）。
- `DebugSourcePage.test.tsx`：渲染、阶段切换、运行显示结果。
- 现有测试保持绿：`npm test`（163 个）。

## 7. 交付文件

- `src/pages/DebugSourcePage.tsx`（新建）
- `src/services/sourceDebug.ts`（新建）
- `src/services/sourceDebug.test.ts`（新建）
- `src/components/BookSourceManager.tsx`（调试按钮）
- `src/App.tsx`（debugSource view）
- `src/App.css`（调试样式）
- `DebugSourcePage.test.tsx`

## 8. 已知限制

- 调试为只读查看，不支持规则在线编辑。
- 列表字段值截断展示（完整值可复制 HTML）。
- 不实现 WebSocket 远程调试。
