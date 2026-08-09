# 书源导入方式重构设计文档

日期：2026-08-09
状态：已批准

## 1. 背景与目标

书源管理目前只有「粘贴 JSON 文本框」一种导入方式。用户粘贴 URL 时应用报 JSON 解析错误（`Unexpected token 'h'`），体验差。同时书源来源主要有两类：本地书源 JSON 文件、网络书源分享。

**目标**：书源导入只保留两种方式：
1. **本地文件导入**：系统文件选择器选择 `.json` 文件，解析并添加。
2. **网络导入**：粘贴书源 JSON 的网址，下载内容并解析添加。

移除手动粘贴 JSON 文本框。

## 2. 技术架构

```
书源管理 UI
├─ 「从文件导入」按钮 → 系统文件选择器(.json) → 读文件内容 → 解析书源 → addBookSource
└─ 「从网址导入」输入框+按钮 → httpGet(url) → 下载内容 → 解析书源 → addBookSource

解析层（纯函数，可测）：
  extractBookSourceFromText(text) → 书源对象（单个）
  · 先 JSON.parse：
    · 对象且有 bookSourceUrl → 直接用
    · 数组 → 取第一个有 bookSourceUrl 的元素
  · JSON 失败（HTML 页面）→ HTML 提取：
    · <pre>/<textarea> 内 JSON
    · 内联 window.bookSource= / {"bookSourceUrl": 首次出现截取
  · 提取到数组则取第一个有效书源
  · 无有效书源 → 抛中文错误
```

## 3. 文件改动

- **新建 `src/services/bookSourceImport.ts`**：
  - `export function extractBookSourceFromText(text: string): any` — 核心解析函数（纯函数）
  - `export async function importBookSourceFromUrl(url: string): Promise<{ name: string; url: string }>` — 下载 + 解析 + 校验，返回书源摘要（供 UI 提示）
  - `export async function importBookSourceFromFile(path: string): Promise<{ name: string; url: string }>` — 读文件 + 解析 + 校验（实际读文件走现有 `readFileContent` 命令）
- **修改 `src/components/BookSourceManager.tsx`**：
  - 移除粘贴 JSON 文本框与「添加书源」按钮
  - 新增「从文件导入」按钮（`@tauri-apps/plugin-dialog` 的 `open()` 选择器，过滤 `.json`）
  - 新增「从网址导入」输入框 + 按钮
  - 导入成功/失败提示
- **修改 `src/services/api.ts`**：无需改（复用 `httpGet`、`addBookSource`、`readFileContent`）
- **测试**：
  - `bookSourceImport.test.ts`：JSON 对象 / JSON 数组 / HTML `<pre>` / HTML 内联 / 无书源抛错
  - `BookSourceManager.test.tsx`：更新为测试文件导入与网址导入入口

## 4. 解析函数详细规则

```ts
export function extractBookSourceFromText(text: string): any {
  const trimmed = text.trim();
  // 1) 直接 JSON 解析
  try {
    const obj = JSON.parse(trimmed);
    const cand = Array.isArray(obj) ? obj : [obj];
    const hit = cand.find((s) => s && typeof s === "object" && s.bookSourceUrl && s.bookSourceName);
    if (hit) return hit;
  } catch { /* 走 HTML 提取 */ }
  // 2) HTML/文本中提取：优先 <pre>/<textarea>，其次内联 {"bookSourceUrl":
  const pre = /<(?:pre|textarea)[^>]*>([\s\S]*?)<\/(?:pre|textarea)>/i.exec(text);
  if (pre) {
    const hit = tryParseAsBookSource(pre[1]);
    if (hit) return hit;
  }
  const inline = /\{[^{}]*"bookSourceUrl"\s*:\s*"[^"]*"[^{}]*\}/.exec(text);
  if (inline) {
    const hit = tryParseAsBookSource(inline[0]);
    if (hit) return hit;
  }
  throw new Error("未能从内容中解析出书源，请确认是书源 JSON 文件或包含书源信息的网页");
}

function tryParseAsBookSource(s: string): any {
  try {
    const obj = JSON.parse(s.trim());
    const cand = Array.isArray(obj) ? obj : [obj];
    return cand.find((x) => x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName) || null;
  } catch { return null; }
}
```

## 5. 交互细节

- 「从文件导入」：`open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] })`，返回路径 → `readFileContent(path)` → 解析 → `addBookSource(name, url, JSON.stringify(bookSource))` → 刷新列表。
- 「从网址导入」：输入 URL → `httpGet(url, undefined, 20000)`（20s 超时）→ 解析 → 添加。空 URL 按钮禁用。
- 导入后清空网址输入框；失败显示 `error` 文案（中文）。

## 6. 测试

- `bookSourceImport.test.ts`：4 个成功场景 + 1 个失败场景（纯函数，fixture 文本）
- `BookSourceManager.test.tsx`：mock `open`/`readFileContent`/`httpGet`/`addBookSource`，验证两个入口触发对应调用链
- 现有测试保持绿：`npm test`（75 个）

## 7. 已知限制

- 网络导入仅支持返回纯 JSON 或 HTML 内嵌书源信息的页面；动态 JS 渲染的书源页无法处理（无浏览器执行）
- 文件导入仅 `.json` 扩展名
