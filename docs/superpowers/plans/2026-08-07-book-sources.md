# 书源支持（legado 规则）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「阅卷」阅读器增加兼容 legado 规则格式的网页抓取书源能力：搜索、目录浏览、在线阅读章节。

**Architecture:** Rust 侧 `reqwest` 负责网络与编码（仅暴露 `http_get`），WebView 前端 `bookSourceEngine.ts` 实现完整规则引擎（CSS 选择器 / XPath / `@js:` / 正则），书源与进度存入 SQLite。前端通过 Tauri IPC 调用。

**Tech Stack:** Rust (reqwest, encoding_rs, rusqlite), React 18 + TS + Vite, Vitest

**Spec:** `docs/superpowers/specs/2026-08-07-book-sources-design.md`

## Global Constraints

- Rust 侧只做网络与编码，规则引擎全部在前端 `src/services/bookSourceEngine.ts`。
- 命令名固定为：`http_get`, `list_book_sources`, `add_book_source`, `update_book_source`, `delete_book_source`, `set_book_source_enabled`, `get_book_source_progress`, `save_book_source_progress`（前端 api.ts 依赖）。
- 新增 SQLite 表：`book_sources`, `book_source_progress`（见 spec §7），DDL 用 `IF NOT EXISTS`。
- 前端规则引擎输入/输出为纯数据（不触碰 DOM document 的全局状态），以便 Vitest 用本地 fixture 测试。
- UI 文案使用中文。
- 现有测试必须保持绿（`npm test` 36 个，`cargo test` 20 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: Rust 网络层 `http_get`

**Files:**
- Create: `src-tauri/src/net.rs`
- Modify: `src-tauri/src/commands.rs`（注册命令）
- Modify: `src-tauri/src/lib.rs`（`pub mod net;` + 注册）
- Modify: `src-tauri/Cargo.toml`（加 reqwest）
- Test: `src-tauri/tests/net_test.rs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `#[tauri::command] pub fn http_get(url: String, headers: Option<HashMap<String, String>>, timeout_ms: Option<u64>) -> Result<String, String>` — 请求指定 URL，返回解码后的 HTML 字符串。默认超时 15s（`timeout_ms` 覆盖）。自动处理 UTF-8 / GBK 解码。
  - `pub struct HttpGetOptions { pub headers: HashMap<String, String>, pub timeout_ms: Option<u64> }` — 内部类型。

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/net_test.rs`：
```rust
use yd_lib::net::decode_body;

#[test]
fn decodes_utf8() {
    let html = "你好世界".as_bytes().to_vec();
    assert_eq!(decode_body(&html, None).unwrap(), "你好世界");
}

#[test]
fn decodes_gbk() {
    // "测试" 的 GBK 编码字节
    let gbk = [0xB2, 0xE2, 0xCA, 0xD4];
    assert_eq!(decode_body(&gbk, None).unwrap(), "测试");
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test net_test`
Expected: 编译失败（`yd_lib::net` 不存在）。

- [ ] **Step 3: 实现 net.rs**

```rust
use std::collections::HashMap;
use tauri::State;
use crate::commands::AppState;

pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;

pub fn decode_body(bytes: &[u8], _charset_hint: Option<&str>) -> Result<String, String> {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }
    // GBK 优先，其次 latin1 兜底（保证不崩溃）
    let (cow, _) = encoding_rs::GBK.decode(bytes);
    Ok(cow.into_owned())
}

#[tauri::command]
pub fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let mut req = client.get(&url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(&k, &v);
        }
    }
    let resp = req.send().map_err(|e| format!("网络请求失败: {e}"))?;
    let bytes = resp.bytes().map_err(|e| format!("读取响应失败: {e}"))?;
    decode_body(&bytes, None)
}
```
> 注：`http_get` 不需要 AppState，故签名不含 `State`。`reqwest` 使用 `blocking` 特性，Tauri 命令在独立线程池执行，不会阻塞 UI。若未来需要响应式取消，再引入异步改造。

`src-tauri/src/commands.rs` 无需改动。`src-tauri/Cargo.toml` 执行 `cargo add reqwest --features blocking`。

- [ ] **Step 4: 在 lib.rs 注册**

`src-tauri/src/lib.rs`：
```rust
pub mod net;
```
`generate_handler!` 中加入 `crate::net::http_get,`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --test net_test`
Expected: 2 个测试 PASS。另跑 `cargo check` 确认编译。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/
git commit -m "feat: Rust http_get 网络层"
```

---

### Task 2: 规则引擎核心（表达式解析 + 提取）

**Files:**
- Create: `src/services/bookSourceEngine.ts`
- Create: `src/services/bookSourceEngine.test.ts`
- Create: `src/services/fixtures.ts`（HTML 样例 + 书源 JSON 样例）

**Interfaces:**
- Produces（供 Task 3-8 使用，签名固定）：
  - `export type EngineResult = string`
  - `export function parseRule(rule: string): { type: "css" | "regex" | "regexReplace" | "js" | "xpath" | "plain"; value: string; attr?: string }`
  - `export function parseHtml(html: string): Document`
  - `export function selectNodes(doc: Document, selector: string): Element[]`
  - `export function nodeValue(node: Element, attr?: string): string` — `attr` 支持 `text`/`href`/`src`/`ownText`/`all`；缺省取 `text`。
  - `export function extractSingle(doc: Document, rule: string, ctx?: { baseUrl: string }): string` — 解析一条规则并提取单个值（首次匹配），自动把 `href/src` 相对路径拼接为绝对 URL。
  - `export function extractList(doc: Document, listRule: string, itemRules: { [k: string]: string }): Array<{ [k: string]: string }>` — 解析列表容器规则，对每个元素应用 itemRules。
  - `export function resolveUrl(href: string, baseUrl: string): string`
  - `export interface BookSource { bookSourceUrl: string; bookSourceName: string; bookSourceType?: number; enabled?: boolean; httpUserAgent?: string; httpHeaders?: Record<string, string>; searchUrl?: string; bookUrlPattern?: string; ruleSearch?: any; ruleBookInfo?: any; ruleToc?: any; ruleContent?: any }`
  - `export function parseBookSourceJson(raw: string): BookSource` — 解析并校验必填字段，非法时抛错。

- [ ] **Step 1: 写失败的测试**

`src/services/fixtures.ts`：
```ts
export const SAMPLE_HTML = `<!doctype html><html><body>
<ul class="book-list">
  <li><a class="b-name" href="/book/1.html">三体</a><span class="b-author">刘慈欣</span><img class="b-cover" src="/cover/1.jpg"/></li>
  <li><a class="b-name" href="/book/2.html">活着</a><span class="b-author">余华</span><img class="b-cover" src="/cover/2.jpg"/></li>
</ul>
<div id="content"><p>第一章正文第一段。</p><p>第一章正文第二段。</p></div>
</body></html>`;

export const SAMPLE_SOURCE: any = {
  bookSourceUrl: "https://example.com",
  bookSourceName: "示例书源",
  searchUrl: "https://example.com/search?q={{key}}",
  ruleSearch: {
    bookList: "@css:ul.book-list>li",
    name: "a.b-name@text",
    author: "span.b-author@text",
    coverUrl: "img.b-cover@src",
    bookUrl: "a.b-name@href",
  },
  ruleContent: { content: "#content" },
};
```

`src/services/bookSourceEngine.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { parseHtml, extractSingle, extractList, resolveUrl, parseBookSourceJson } from "./bookSourceEngine";
import { SAMPLE_HTML, SAMPLE_SOURCE } from "./fixtures";

describe("bookSourceEngine", () => {
  const doc = parseHtml(SAMPLE_HTML);

  it("extracts a single CSS value with text", () => {
    expect(extractSingle(doc, "a.b-name@text", { baseUrl: "https://example.com" })).toBe("三体");
  });

  it("extracts href and resolves to absolute URL", () => {
    const href = extractSingle(doc, "a.b-name@href", { baseUrl: "https://example.com" });
    expect(href).toBe("https://example.com/book/1.html");
  });

  it("extracts a list of items", () => {
    const list = extractList(doc, "@css:ul.book-list>li", {
      name: "a.b-name@text",
      bookUrl: "a.b-name@href",
      coverUrl: "img.b-cover@src",
    });
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("三体");
    expect(list[1].bookUrl).toBe("https://example.com/book/2.html");
  });

  it("parses a valid book source JSON", () => {
    const src = parseBookSourceJson(JSON.stringify(SAMPLE_SOURCE));
    expect(src.bookSourceName).toBe("示例书源");
    expect(src.ruleSearch.name).toBe("a.b-name@text");
  });

  it("rejects invalid book source JSON", () => {
    expect(() => parseBookSourceJson("{}")).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 bookSourceEngine.ts**

```ts
import { JSDOM } from "jsdom";

export interface BookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceType?: number;
  enabled?: boolean;
  httpUserAgent?: string;
  httpHeaders?: Record<string, string>;
  searchUrl?: string;
  bookUrlPattern?: string;
  ruleSearch?: Record<string, string>;
  ruleBookInfo?: Record<string, string>;
  ruleToc?: Record<string, string>;
  ruleContent?: Record<string, string>;
}

export function parseBookSourceJson(raw: string): BookSource {
  const obj = JSON.parse(raw);
  if (!obj.bookSourceUrl || !obj.bookSourceName) {
    throw new Error("书源缺少 bookSourceUrl 或 bookSourceName");
  }
  return obj as BookSource;
}

export function parseHtml(html: string): Document {
  const dom = new JSDOM(html);
  return dom.window.document;
}

export function parseRule(rule: string): { type: string; value: string; attr?: string } {
  const s = rule.trim();
  if (s.startsWith("@css:")) {
    return parseAttrRule(s.slice(5));
  }
  if (s.startsWith("@xpath:")) {
    return { type: "xpath", value: s.slice(7) };
  }
  if (s.startsWith("@js:")) {
    return { type: "js", value: s.slice(4) };
  }
  if (s.startsWith("##")) {
    return { type: "regexReplace", value: s.slice(2) };
  }
  if (s.includes("{{")) {
    return { type: "regex", value: s };
  }
  return parseAttrRule(s);
}

function parseAttrRule(s: string): { type: string; value: string; attr?: string } {
  const m = s.match(/^(.+?)@([a-zA-Z]+)$/);
  if (m) {
    return { type: "css", value: m[1], attr: m[2] };
  }
  return { type: "css", value: s, attr: "text" };
}

export function selectNodes(doc: Document, selector: string): Element[] {
  return Array.from(doc.querySelectorAll(selector));
}

const ABS_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveUrl(href: string, baseUrl: string): string {
  if (ABS_URL_RE.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function nodeValue(node: Element, attr?: string): string {
  const a = attr ?? "text";
  switch (a) {
    case "text":
      return (node.textContent ?? "").trim();
    case "ownText": {
      let out = "";
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.textContent;
      }
      return out.trim();
    }
    case "all":
      return (node.textContent ?? "").trim();
    case "href":
      return node.getAttribute("href") ?? "";
    case "src":
      return node.getAttribute("src") ?? "";
    default:
      return node.getAttribute(a) ?? (node.textContent ?? "").trim();
  }
}

export function extractSingle(doc: Document, rule: string, ctx?: { baseUrl?: string }): string {
  const parsed = parseRule(rule);
  if (parsed.type === "regex") {
    const m = rule.match(/{{(.*?)}}/);
    if (m) {
      const re = new RegExp(m[1]);
      const hit = re.exec(doc.body?.textContent ?? "");
      return hit ? (hit[1] ?? hit[0]) : "";
    }
    return "";
  }
  if (parsed.type === "regexReplace") {
    const parts = rule.slice(2).split("##");
    const re = new RegExp(parts[0], "g");
    return (doc.body?.textContent ?? "").replace(re, parts[1] ?? "");
  }
  if (parsed.type === "xpath") {
    const result = doc.evaluate(parsed.value, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue as Element | null;
    return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
  }
  if (parsed.type === "js") {
    // Task 3 实现；此处返回空串占位
    return "";
  }
  const node = doc.querySelector(parsed.value);
  return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
}

function finalize(v: string, attr?: string, baseUrl?: string): string {
  if (!v) return "";
  if (attr === "href" || attr === "src") return baseUrl ? resolveUrl(v, baseUrl) : v;
  return v;
}

export function extractList(
  doc: Document,
  listRule: string,
  itemRules: Record<string, string>,
): Array<Record<string, string>> {
  const parsed = parseRule(listRule);
  if (parsed.type !== "css") return [];
  const nodes = selectNodes(doc, parsed.value);
  return nodes.map((node) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) {
      out[key] = extractFromElement(node, rule);
    }
    return out;
  });
}

function extractFromElement(el: Element, rule: string): string {
  const parsed = parseRule(rule);
  if (parsed.type !== "css") return "";
  const node = el.matches(parsed.value) ? el : el.querySelector(parsed.value);
  return node ? nodeValue(node as Element, parsed.attr) : "";
}
```

> 注：测试需要 jsdom。vitest 已配置 `environment: "jsdom"`，但 `bookSourceEngine.ts` 直接在模块级 import `JSDOM`（来自 jsdom 包，已是 devDependency）。用 `new JSDOM(html).window.document` 而非全局 `document`，保证与真实浏览器等价且可测。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/
git commit -m "feat: 规则引擎核心（CSS/正则/节点取值/URL拼接）"
```

---

### Task 3: 规则引擎增强（@js: 与 XPath 提取列表、替换规则）

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`
- Modify: `src/services/fixtures.ts`

**Interfaces:**
- Consumes: Task 2 的 `parseRule`, `nodeValue`, `extractFromElement`（内部）、`extractList`
- Produces:
  - `export function evalJs(expr: string, ctx: { node?: Element; doc: Document; baseUrl?: string }): string` — 执行 `@js:` 表达式；提供 `java` 对象（含 `base64` 解码、`regex`），参数含 `node`、`doc`、`result`、`baseUrl`。
  - `extractList` 支持 `@xpath:` 列表规则。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { evalJs } from "./bookSourceEngine";

it("evaluates @js: expression with node context", () => {
  const doc2 = parseHtml(`<a href="/x/1.html">书名</a>`);
  const node = doc2.querySelector("a")!;
  const out = evalJs("node.getAttribute('href')", { node, doc: doc2, baseUrl: "https://ex.com" });
  expect(out).toBe("/x/1.html");
});

it("evaluates @js: with java.base64", () => {
  const doc3 = parseHtml("<html><body></body></html>");
  const out = evalJs("java.base64Decode('5L2g5aW9')", { doc: doc3, baseUrl: "https://ex.com" });
  expect(out).toBe("你好");
});

it("extracts list via @xpath:", () => {
  const doc4 = parseHtml(SAMPLE_HTML);
  const list = extractList(doc4, "@xpath://ul[@class='book-list']/li", { name: "a.b-name@text" });
  expect(list.length).toBe(2);
  expect(list[0].name).toBe("三体");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 新增 3 个 FAIL（`evalJs` 未导出 / xpath 列表不支持）。

- [ ] **Step 3: 实现增强**

`bookSourceEngine.ts` 追加：
```ts
export function evalJs(expr: string, ctx: { node?: Element; doc: Document; baseUrl?: string }): string {
  const java = {
    base64Decode: (b64: string) => atob(b64),
    regex: (input: string, pattern: string) => {
      const m = input.match(new RegExp(pattern));
      return m ? (m[1] ?? m[0]) : "";
    },
  };
  const fn = new Function("node", "doc", "result", "baseUrl", "java", `"use strict"; return (${expr});`);
  try {
    const result = fn(ctx.node ?? null, ctx.doc, "", ctx.baseUrl ?? "", java);
    return result == null ? "" : String(result);
  } catch (e) {
    return "";
  }
}
```
`extractSingle` 的 `js` 分支改为：
```ts
if (parsed.type === "js") {
  return evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl });
}
```
`extractList` 增加 xpath 分支：
```ts
if (parsed.type === "xpath") {
  const nodes = doc.evaluate(parsed.value, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const arr: Element[] = [];
  for (let i = 0; i < nodes.snapshotLength; i++) {
    const n = nodes.snapshotItem(i) as Element | null;
    if (n) arr.push(n);
  }
  return arr.map((node) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule);
    return out;
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 8 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/services/
git commit -m "feat: 规则引擎增强（@js: 与 XPath 列表）"
```

---

### Task 4: 数据层（book_sources / book_source_progress）

**Files:**
- Modify: `src-tauri/src/db.rs`（建表 + CRUD）
- Modify: `src-tauri/src/commands.rs`（6 个命令）
- Modify: `src-tauri/src/lib.rs`（注册）
- Test: `src-tauri/tests/source_db_test.rs`

**Interfaces:**
- Consumes: 无（新建表）
- Produces（db.rs 函数，命令层调用）：
  - `pub fn list_sources(conn: &Connection) -> Result<Vec<SourceRow>, rusqlite::Error>`
  - `pub fn add_source(conn: &Connection, name: &str, url: &str, json: &str) -> Result<i64, rusqlite::Error>`
  - `pub fn update_source(conn: &Connection, id: i64, name: &str, url: &str, json: &str) -> Result<(), rusqlite::Error>`
  - `pub fn delete_source(conn: &Connection, id: i64) -> Result<(), rusqlite::Error>`
  - `pub fn set_source_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<(), rusqlite::Error>`
  - `pub fn get_source_progress(conn: &Connection, source_id: i64, book_url: &str) -> Result<Option<SourceProgress>, rusqlite::Error>`
  - `pub fn save_source_progress(conn: &Connection, p: &NewSourceProgress) -> Result<(), rusqlite::Error>`
  - `pub struct SourceRow { pub id: i64, pub name: String, pub url: String, pub json: String, pub enabled: bool, pub last_used_at: Option<i64> }`
  - `pub struct SourceProgress { pub source_id: i64, pub book_url: String, pub title: String, pub chapter_index: i64, pub chapter_url: String, pub chapter_name: String, pub percent: f64, pub updated_at: i64 }`
  - `pub struct NewSourceProgress { pub source_id: i64, pub book_url: String, pub title: String, pub chapter_index: i64, pub chapter_url: String, pub chapter_name: String, pub percent: f64 }`

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/source_db_test.rs`：
```rust
use std::fs;
use tempfile::tempdir;
use yd_lib::db::*;

#[test]
fn source_crud() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let id = add_source(&conn, "示例", "https://ex.com", "{\"a\":1}").unwrap();
    let list = list_sources(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "示例");
    set_source_enabled(&conn, id, false).unwrap();
    assert!(!list_sources(&conn).unwrap()[0].enabled);
    update_source(&conn, id, "改名", "https://ex.com", "{\"b\":2}").unwrap();
    assert_eq!(list_sources(&conn).unwrap()[0].json, "{\"b\":2}");
    delete_source(&conn, id).unwrap();
    assert!(list_sources(&conn).unwrap().is_empty());
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}

#[test]
fn source_progress_upsert() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path().join("test.db")).unwrap();
    let sid = add_source(&conn, "s", "https://ex.com", "{}").unwrap();
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/book/1.html".into(),
        title: "三体".into(), chapter_index: 0, chapter_url: "c0".into(),
        chapter_name: "第一章".into(), percent: 0.5,
    }).unwrap();
    let p = get_source_progress(&conn, sid, "https://ex.com/book/1.html").unwrap().unwrap();
    assert_eq!(p.chapter_name, "第一章");
    assert!((p.percent - 0.5).abs() < 1e-9);
    save_source_progress(&conn, &NewSourceProgress {
        source_id: sid, book_url: "https://ex.com/book/1.html".into(),
        title: "三体".into(), chapter_index: 1, chapter_url: "c1".into(),
        chapter_name: "第二章".into(), percent: 0.1,
    }).unwrap();
    let p2 = get_source_progress(&conn, sid, "https://ex.com/book/1.html").unwrap().unwrap();
    assert_eq!(p2.chapter_name, "第二章");
    drop(conn);
    fs::remove_dir_all(dir.path()).unwrap();
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test source_db_test`
Expected: 编译失败（函数不存在）。

- [ ] **Step 3: 实现 db.rs 追加**

在 `init_db` 的 `execute_batch` 内追加：
```sql
CREATE TABLE IF NOT EXISTS book_sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS book_source_progress (
    source_id INTEGER NOT NULL,
    book_url TEXT NOT NULL,
    title TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    chapter_url TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    percent REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, book_url)
);
```

追加函数：
```rust
#[derive(Debug, Clone)]
pub struct SourceRow { pub id: i64, pub name: String, pub url: String, pub json: String, pub enabled: bool, pub last_used_at: Option<i64> }

#[derive(Debug, Clone)]
pub struct SourceProgress { pub source_id: i64, pub book_url: String, pub title: String, pub chapter_index: i64, pub chapter_url: String, pub chapter_name: String, pub percent: f64, pub updated_at: i64 }

#[derive(Debug, Clone)]
pub struct NewSourceProgress { pub source_id: i64, pub book_url: String, pub title: String, pub chapter_index: i64, pub chapter_url: String, pub chapter_name: String, pub percent: f64 }

pub fn list_sources(conn: &Connection) -> Result<Vec<SourceRow>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, name, url, json, enabled, last_used_at FROM book_sources ORDER BY name")?;
    let rows = stmt.query_map([], |r| Ok(SourceRow {
        id: r.get(0)?, name: r.get(1)?, url: r.get(2)?, json: r.get(3)?,
        enabled: r.get::<_, i64>(4)? != 0, last_used_at: r.get(5)?,
    }))?;
    rows.collect()
}

pub fn add_source(conn: &Connection, name: &str, url: &str, json: &str) -> Result<i64, rusqlite::Error> {
    conn.execute("INSERT INTO book_sources (name, url, json) VALUES (?1, ?2, ?3)", rusqlite::params![name, url, json])?;
    Ok(conn.last_insert_rowid())
}

pub fn update_source(conn: &Connection, id: i64, name: &str, url: &str, json: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE book_sources SET name=?1, url=?2, json=?3 WHERE id=?4", rusqlite::params![name, url, json, id])?;
    Ok(())
}

pub fn delete_source(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM book_sources WHERE id=?1", [id])?;
    conn.execute("DELETE FROM book_source_progress WHERE source_id=?1", [id])?;
    Ok(())
}

pub fn set_source_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE book_sources SET enabled=?1 WHERE id=?2", rusqlite::params![if enabled { 1 } else { 0 }, id])?;
    Ok(())
}

pub fn get_source_progress(conn: &Connection, source_id: i64, book_url: &str) -> Result<Option<SourceProgress>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT source_id, book_url, title, chapter_index, chapter_url, chapter_name, percent, updated_at FROM book_source_progress WHERE source_id=?1 AND book_url=?2")?;
    let mut rows = stmt.query(rusqlite::params![source_id, book_url])?;
    if let Some(r) = rows.next()? {
        Ok(Some(SourceProgress {
            source_id: r.get(0)?, book_url: r.get(1)?, title: r.get(2)?,
            chapter_index: r.get(3)?, chapter_url: r.get(4)?, chapter_name: r.get(5)?,
            percent: r.get(6)?, updated_at: r.get(7)?,
        }))
    } else { Ok(None) }
}

pub fn save_source_progress(conn: &Connection, p: &NewSourceProgress) -> Result<(), rusqlite::Error> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    conn.execute(
        "INSERT INTO book_source_progress (source_id, book_url, title, chapter_index, chapter_url, chapter_name, percent, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(source_id, book_url) DO UPDATE SET title=excluded.title, chapter_index=excluded.chapter_index,
           chapter_url=excluded.chapter_url, chapter_name=excluded.chapter_name, percent=excluded.percent, updated_at=excluded.updated_at",
        rusqlite::params![p.source_id, p.book_url, p.title, p.chapter_index, p.chapter_url, p.chapter_name, p.percent, now],
    )?;
    Ok(())
}
```

`commands.rs` 追加 6 个命令（`#[tauri::command]`），把 `SourceRow`/`SourceProgress` 序列化回前端。为此在 `db.rs` 中给这两个结构体加 serde derive：
```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct SourceRow { ... }
#[derive(Debug, Clone, serde::Serialize)]
pub struct SourceProgress { ... }
```
`lib.rs` 注册 6 个命令。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --test source_db_test`
Expected: 2 个测试 PASS。另跑 `cargo test` 全量确认原有 20 个仍绿。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/
git commit -m "feat: 书源数据层与 CRUD 命令"
```

---

### Task 5: 前端 api 封装 + 书源管理 UI

**Files:**
- Modify: `src/services/api.ts`（新增书源 API 封装）
- Create: `src/components/BookSourceManager.tsx`
- Create: `src/components/BookSourceManager.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`（挂载 BookSourceManager）
- Modify: `src/App.css`（书源管理样式）

**Interfaces:**
- Consumes: Task 4 命令（前端 api.ts 封装）
- Produces:
  - api.ts 新增：
    - `export interface BookSource { id: number; name: string; url: string; json: string; enabled: boolean; last_used_at: number | null }`
    - `export function listBookSources(): Promise<BookSource[]>`
    - `export function addBookSource(name: string, url: string, json: string): Promise<number>`
    - `export function updateBookSource(id: number, name: string, url: string, json: string): Promise<void>`
    - `export function deleteBookSource(id: number): Promise<void>`
    - `export function setBookSourceEnabled(id: number, enabled: boolean): Promise<void>`
  - `BookSourceManager` 无 props；内部管理列表状态。

- [ ] **Step 1: 写失败的测试**

`src/components/BookSourceManager.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookSourceManager from "./BookSourceManager";
import * as api from "../services/api";

const sources = [
  { id: 1, name: "示例书源", url: "https://ex.com", json: "{}", enabled: true, last_used_at: null },
];

describe("BookSourceManager", () => {
  it("renders sources with enable toggle", async () => {
    vi.spyOn(api, "listBookSources").mockResolvedValue(sources);
    render(<BookSourceManager />);
    expect(await screen.findByText("示例书源")).toBeInTheDocument();
  });

  it("adds a source from pasted JSON", async () => {
    vi.spyOn(api, "listBookSources").mockResolvedValue([]);
    const addSpy = vi.spyOn(api, "addBookSource").mockResolvedValue(5);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(
      screen.getByLabelText("书源 JSON"),
      '{"bookSourceUrl":"https://ex.com","bookSourceName":"测试"}',
    );
    await userEvent.click(screen.getByRole("button", { name: /添加书源/ }));
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: api.ts 追加封装**

```ts
export interface BookSource {
  id: number; name: string; url: string; json: string;
  enabled: boolean; last_used_at: number | null;
}

export async function listBookSources(): Promise<BookSource[]> {
  return invoke<BookSource[]>("list_book_sources");
}
export async function addBookSource(name: string, url: string, json: string): Promise<number> {
  return invoke<number>("add_book_source", { name, url, json });
}
export async function updateBookSource(id: number, name: string, url: string, json: string): Promise<void> {
  await invoke("update_book_source", { id, name, url, json });
}
export async function deleteBookSource(id: number): Promise<void> {
  await invoke("delete_book_source", { id });
}
export async function setBookSourceEnabled(id: number, enabled: boolean): Promise<void> {
  await invoke("set_book_source_enabled", { id, enabled });
}
```

- [ ] **Step 4: 实现 BookSourceManager.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import { addBookSource, deleteBookSource, listBookSources, setBookSourceEnabled, type BookSource } from "../services/api";

export default function BookSourceManager() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!raw.trim()) return;
    setError(null);
    try {
      const obj = JSON.parse(raw);
      if (!obj.bookSourceName || !obj.bookSourceUrl) {
        setError("书源 JSON 缺少 bookSourceName 或 bookSourceUrl");
        return;
      }
      await addBookSource(obj.bookSourceName, obj.bookSourceUrl, JSON.stringify(obj));
      setRaw("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    await deleteBookSource(id);
    await refresh();
  };

  return (
    <div className="book-source-manager">
      <h3>书源</h3>
      {error && <p className="error">{error}</p>}
      {sources.length === 0 ? (
        <p className="panel-empty">暂无书源，粘贴 legado 书源 JSON 添加</p>
      ) : (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <div className="source-info">
                <span className="source-name">{s.name}</span>
                <span className="source-url">{s.url}</span>
              </div>
              <div className="source-actions">
                <input
                  type="checkbox"
                  aria-label={`启用 ${s.name}`}
                  checked={s.enabled}
                  onChange={(e) => { void setBookSourceEnabled(s.id, e.target.checked); void refresh(); }}
                />
                <button className="btn btn-ghost" onClick={() => handleDelete(s.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-add">
        <textarea
          aria-label="书源 JSON"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='粘贴书源 JSON，如 {"bookSourceUrl":"...","bookSourceName":"...",...}'
          rows={4}
        />
        <button className="btn btn-primary" onClick={handleAdd} disabled={!raw.trim()}>添加书源</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: SettingsPage 挂载 + 样式**

`src/pages/SettingsPage.tsx`：在 `settings-form` 末尾追加 `<BookSourceManager />`（import 进来）。`src/App.css` 追加：
```css
.book-source-manager { max-width: 520px; padding: 22px 0; border-top: 1px solid var(--border); }
.book-source-manager h3 { margin: 0 0 14px; font-family: var(--font-read); font-size: 16px; }
.source-list { list-style: none; margin: 0 0 14px; padding: 0; }
.source-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px; }
.source-info { display: flex; flex-direction: column; min-width: 0; }
.source-name { font-size: 14px; font-weight: 600; color: var(--fg); }
.source-url { font-size: 12px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-actions { display: flex; align-items: center; gap: 8px; }
.book-source-manager textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font-size: 12px; font-family: ui-monospace, Consolas, monospace; resize: vertical; }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: 2 个测试 PASS。跑全量 `npm test` 确认 36+2 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/
git commit -m "feat: 书源管理 UI"
```

---

### Task 6: 发现与搜索（书源入口）

**Files:**
- Create: `src/pages/DiscoverPage.tsx`
- Modify: `src/App.tsx`（路由到 DiscoverPage）
- Modify: `src/pages/LibraryPage.tsx`（「发现」入口按钮）
- Modify: `src/App.css`
- Test: `src/pages/DiscoverPage.test.tsx`

**Interfaces:**
- Consumes: Task 2-3 的引擎、Task 5 的 `listBookSources`、Task 1 的 `http_get`（api.ts 需封装）
- Produces:
  - api.ts 追加：`export async function httpGet(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string>`
  - `DiscoverPage` props: `{ onBack: () => void; onOpenBook: (book: { title: string; url: string; sourceId: number; sourceName: string }) => void }`
  - 搜索流程：`searchSources(key: string, sources: BookSource[]): Promise<SearchHit[]>`，`SearchHit = { title: string; author: string; coverUrl: string; bookUrl: string; sourceId: number; sourceName: string }`

- [ ] **Step 1: 写失败的测试**

`src/pages/DiscoverPage.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoverPage from "./DiscoverPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
}));

describe("DiscoverPage", () => {
  it("searches enabled sources and lists hits", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例书源", url: "https://ex.com", json: JSON.stringify({
        bookSourceUrl: "https://ex.com", bookSourceName: "示例书源",
        searchUrl: "https://ex.com/search?q={{key}}",
        ruleSearch: { bookList: "@css:li", name: ".name@text", author: ".author@text", bookUrl: ".name@href" },
      }), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul><li><span class="name">三体</span><span class="author">刘慈欣</span><a class="name" href="/b/1.html"></a></li></ul>`,
    );
    render(<DiscoverPage onBack={() => {}} onOpenBook={() => {}} />);
    await userEvent.type(screen.getByLabelText("搜索关键词"), "三体");
    await userEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText(/示例书源/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: api.ts 追加 httpGet**

```ts
export async function httpGet(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string> {
  return invoke<string>("http_get", { url, headers: headers ?? null, timeoutMs: timeoutMs ?? null });
}
```

- [ ] **Step 4: 实现搜索逻辑 + DiscoverPage**

`src/pages/DiscoverPage.tsx`：
```tsx
import { useState } from "react";
import { httpGet, listBookSources, type BookSource } from "../services/api";
import { parseHtml, extractList, parseBookSourceJson, type BookSource as Src } from "../services/bookSourceEngine";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: BookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const url = (src.searchUrl ?? "").replace("{{key}}", encodeURIComponent(key));
  if (!url) return [];
  const html = await httpGet(url, src.httpHeaders, undefined);
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  const items = extractList(doc, rules.bookList ?? "", {
    name: rules.name ?? "", author: rules.author ?? "",
    coverUrl: rules.coverUrl ?? "", bookUrl: rules.bookUrl ?? "",
  });
  return items.filter((i) => i.bookUrl).map((i) => ({
    title: i.name || "未命名", author: i.author, coverUrl: i.coverUrl,
    bookUrl: i.bookUrl, sourceId: bs.id, sourceName: bs.name,
  }));
}

export default function DiscoverPage({ onBack, onOpenBook }: {
  onBack: () => void;
  onOpenBook: (h: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true); setError(null);
    try {
      const sources = (await listBookSources()).filter((s) => s.enabled);
      const all = await Promise.all(sources.map((s) => searchSource(query.trim(), s).catch(() => [] as SearchHit[])));
      setHits(all.flat());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="discover page">
      <header className="library-header">
        <div className="brand"><h1>发现</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回书架</button>
      </header>
      <div className="discover-search">
        <input aria-label="搜索关键词" placeholder="输入书名搜索所有已启用书源" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="discover-results">
        {hits.length === 0 && !busy ? (
          <p className="panel-empty">输入关键词开始搜索</p>
        ) : (
          hits.map((h, i) => (
            <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onOpenBook(h)}>
              <div className="hit-info">
                <span className="hit-title">{h.title}</span>
                <span className="hit-author">{h.author}</span>
              </div>
              <span className="hit-source">{h.sourceName}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

`src/App.tsx` 增加 `discover` view 分支；`LibraryPage` 头部「发现」按钮通过新 prop `onOpenDiscover` 传入。`src/App.css` 追加 `.discover-search` / `.hit-card` 等样式。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx`
Expected: 1 个测试 PASS。跑全量 `npm test` 确认。

- [ ] **Step 6: 提交**

```bash
git add src/
git commit -m "feat: 发现与书源搜索"
```

---

### Task 7: 书源书籍页与目录

**Files:**
- Create: `src/pages/SourceBookPage.tsx`
- Modify: `src/App.tsx`（路由）
- Modify: `src/services/api.ts`（get/save 进度封装，供 Task 8 使用；本任务用目录抓取）
- Test: `src/pages/SourceBookPage.test.tsx`

**Interfaces:**
- Consumes: Task 2-3 引擎、Task 6 `SearchHit`
- Produces:
  - `SourceBookPage` props: `{ sourceId: number; sourceName: string; bookUrl: string; initialTitle: string; onBack: () => void; onRead: (chapterIndex: number, chapterUrl: string, chapterName: string) => void }`
  - 抓取目录：`fetchToc(src: Src, bookUrl: string, headers?): Promise<{ title: string; author: string; intro: string; coverUrl: string; toc: Array<{ name: string; url: string }> }>`

- [ ] **Step 1: 写失败的测试**

`src/pages/SourceBookPage.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SourceBookPage from "./SourceBookPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({ httpGet: vi.fn(), getBookSourceProgress: vi.fn().mockResolvedValue(null) }));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: {
    chapterList: "@css:ol>li",
    chapterName: "a@text", chapterUrl: "a@href", nextTocUrl: "",
  },
});

describe("SourceBookPage", () => {
  it("renders book info and chapter list", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><span class="author">刘慈欣</span><ol>
        <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`,
    );
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(screen.getByText("第二章")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: api.ts 追加进度封装**

```ts
export interface SourceProgress {
  source_id: number; book_url: string; title: string; chapter_index: number;
  chapter_url: string; chapter_name: string; percent: number; updated_at: number;
}
export async function getBookSourceProgress(sourceId: number, bookUrl: string): Promise<SourceProgress | null> {
  return invoke<SourceProgress | null>("get_book_source_progress", { sourceId, bookUrl });
}
export async function saveBookSourceProgress(p: { sourceId: number; bookUrl: string; title: string; chapterIndex: number; chapterUrl: string; chapterName: string; percent: number }): Promise<void> {
  await invoke("save_book_source_progress", {
    sourceId: p.sourceId, bookUrl: p.bookUrl, title: p.title,
    chapterIndex: p.chapterIndex, chapterUrl: p.chapterUrl, chapterName: p.chapterName, percent: p.percent,
  });
}
```

- [ ] **Step 4: 实现 SourceBookPage.tsx**

```tsx
import { useEffect, useState } from "react";
import { httpGet, getBookSourceProgress, type BookSource } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, type BookSource as Src } from "../services/bookSourceEngine";

interface TocItem { name: string; url: string }

export default function SourceBookPage({ sourceId, sourceName, bookUrl, initialTitle, onBack, onRead }: {
  sourceId: number; sourceName: string; bookUrl: string; initialTitle: string;
  onBack: () => void; onRead: (index: number, url: string, name: string) => void;
}) {
  const [src, setSrc] = useState<Src | null>(null);
  const [info, setInfo] = useState({ title: initialTitle, author: "", intro: "", coverUrl: "" });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bs = await (await import("../services/api")).listBookSources().then((l) => l.find((x) => x.id === sourceId));
        if (!bs) { setError("书源不存在"); return; }
        const s = parseBookSourceJson(bs.json);
        setSrc(s);
        const html = await httpGet(bookUrl, s.httpHeaders, undefined);
        const doc = parseHtml(html);
        const bi = s.ruleBookInfo ?? {};
        const title = bi.name ? extractSingle(doc, bi.name) : initialTitle;
        const author = bi.author ? extractSingle(doc, bi.author) : "";
        const intro = bi.intro ? extractSingle(doc, bi.intro) : "";
        const cover = bi.coverUrl ? extractSingle(doc, bi.coverUrl) : "";
        const tocUrl = bi.tocUrl ? extractSingle(doc, bi.tocUrl, { baseUrl: bookUrl }) : bookUrl;
        const tocHtml = tocUrl === bookUrl ? html : await httpGet(tocUrl, s.httpHeaders, undefined);
        const tocDoc = parseHtml(tocHtml);
        const rules = s.ruleToc ?? {};
        const items = extractList(tocDoc, rules.chapterList ?? "", {
          name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
        });
        const tocItems = items.filter((i) => i.url).map((i) => ({
          name: i.name || "未命名章节",
          url: i.url.startsWith("http") ? i.url : new URL(i.url, tocUrl).toString(),
        }));
        if (!cancelled) {
          setInfo({ title: title || initialTitle, author, intro, coverUrl: cover });
          setToc(tocItems);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, bookUrl, initialTitle]);

  return (
    <div className="source-book page">
      <header className="library-header">
        <div className="brand"><h1>{info.title}</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="source-book-info">
        <span className="source-name">{sourceName}</span>
        {info.author && <span className="hit-author">{info.author}</span>}
        {info.intro && <p className="source-intro">{info.intro}</p>}
      </div>
      <div className="source-toc">
        {toc.length === 0 ? (
          <p className="panel-empty">暂无目录</p>
        ) : (
          <ol>
            {toc.map((t, idx) => (
              <li key={`${t.url}-${idx}`}>
                <button className="btn btn-ghost" onClick={() => onRead(idx, t.url, t.name)}>{t.name}</button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
```

`src/App.tsx` 增加 `sourceBook` view（含 sourceId/sourceName/bookUrl/initialTitle）分支。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx`
Expected: 1 个测试 PASS。跑全量 `npm test`。

- [ ] **Step 6: 提交**

```bash
git add src/
git commit -m "feat: 书源书籍页与目录"
```

---

### Task 8: 书源阅读页（正文抓取、翻章、进度记忆）

**Files:**
- Create: `src/pages/SourceReaderPage.tsx`
- Modify: `src/App.tsx`（路由）
- Modify: `src/App.css`
- Test: `src/pages/SourceReaderPage.test.tsx`

**Interfaces:**
- Consumes: Task 2-3 引擎、Task 7 的 `SourceProgress` api 封装
- Produces:
  - `SourceReaderPage` props: `{ sourceId: number; bookUrl: string; bookTitle: string; initialChapterIndex: number; initialChapterUrl: string; initialChapterName: string; onBack: () => void }`
  - 章节抓取：`fetchChapter(src: Src, chapterUrl: string, headers?): Promise<{ content: string; nextUrl: string }>`
  - 进度：进入时 `getBookSourceProgress` 恢复；翻章时 `saveBookSourceProgress` 保存。

- [ ] **Step 1: 写失败的测试**

`src/pages/SourceReaderPage.test.tsx`：
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SourceReaderPage from "./SourceReaderPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  saveBookSourceProgress: vi.fn().mockResolvedValue(undefined),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleContent: { content: "#content", nextContentUrl: "" },
});

describe("SourceReaderPage", () => {
  it("fetches and renders chapter content", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content"><p>第一章正文内容。</p></div></body></html>`,
    );
    render(<SourceReaderPage sourceId={1} bookUrl="https://ex.com/book/1.html" bookTitle="三体"
      initialChapterIndex={0} initialChapterUrl="https://ex.com/c/1.html" initialChapterName="第一章" onBack={() => {}} />);
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/SourceReaderPage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 SourceReaderPage.tsx**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "../components/icons";
import { httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, type BookSource as Src } from "../services/bookSourceEngine";

interface ChapterState { index: number; url: string; name: string }

export default function SourceReaderPage({ sourceId, bookUrl, bookTitle, initialChapterIndex, initialChapterUrl, initialChapterName, onBack }: {
  sourceId: number; bookUrl: string; bookTitle: string;
  initialChapterIndex: number; initialChapterUrl: string; initialChapterName: string;
  onBack: () => void;
}) {
  const [chapter, setChapter] = useState<ChapterState>({ index: initialChapterIndex, url: initialChapterUrl, name: initialChapterName });
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nextUrlRef = useRef("");
  const saveTimer = useRef<number | null>(null);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;

  const loadChapter = useCallback(async (c: ChapterState) => {
    setLoading(true); setError(null); setContent("");
    try {
      const bs = (await listBookSources()).find((x) => x.id === sourceId);
      if (!bs) { setError("书源不存在"); return; }
      const src: Src = parseBookSourceJson(bs.json);
      const html = await httpGet(c.url, src.httpHeaders, undefined);
      const doc = parseHtml(html);
      const rules = src.ruleContent ?? {};
      const text = extractSingle(doc, rules.content ?? "body", { baseUrl: c.url });
      const next = rules.nextContentUrl ? extractSingle(doc, rules.nextContentUrl, { baseUrl: c.url }) : "";
      nextUrlRef.current = next;
      setContent(text);
      setLoading(false);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => { void loadChapter(chapter); }, [chapter, loadChapter]);

  const persist = useCallback(() => {
    const c = chapterRef.current;
    void saveBookSourceProgress({
      sourceId, bookUrl, title: bookTitle, chapterIndex: c.index,
      chapterUrl: c.url, chapterName: c.name, percent: 0,
    });
  }, [sourceId, bookUrl, bookTitle]);

  useEffect(() => {
    let cancelled = false;
    void getBookSourceProgress(sourceId, bookUrl).then((p) => {
      if (cancelled) return;
      if (p) {
        // 有历史进度：恢复到最后阅读章节
        setChapter({ index: p.chapter_index, url: p.chapter_url, name: p.chapter_name });
      } else if (initialChapterIndex === -1) {
        // 无进度且未指定起点（直接从书源书籍页「开始阅读」进入）：
        // 保持初始章节为 undefined 状态，由用户点目录选择
        setContent(""); setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [sourceId, bookUrl, initialChapterIndex]);

  useEffect(() => {
    if (!loading) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 800);
    }
  }, [content, loading, persist]);

  const goChapter = (delta: number) => {
    const next = nextUrlRef.current;
    if (!next) return;
    const c: ChapterState = { index: chapter.index + delta, url: next, name: delta > 0 ? `第 ${chapter.index + delta + 1} 章` : `第 ${chapter.index + delta + 1} 章` };
    setChapter(c);
  };

  return (
    <div className="source-reader reader-page">
      <header className="reader-toolbar">
        <button className="btn-icon" onClick={onBack} aria-label="返回" title="返回"><BackIcon size={18} /></button>
        <h2>{bookTitle} · {chapter.name}</h2>
        <button className="btn btn-ghost" onClick={() => goChapter(-1)} disabled={chapter.index === 0}>上一章</button>
        <button className="btn btn-ghost" onClick={() => goChapter(1)} disabled={!nextUrlRef.current}>下一章</button>
      </header>
      <main className="reader-main">
        {loading && <p className="panel-empty">加载中…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && (
          <div className="md-reader"><div className="md-content" dangerouslySetInnerHTML={{ __html: `<p>${content.replace(/\n/g, "</p><p>")}</p>` }} /></div>
        )}
      </main>
    </div>
  );
}
```
> 注：正文净化（去广告标签/替换规则）为 spec 第 9 里程碑的打磨项；本任务先做「按段落包裹展示 + 抓取 + 翻章 + 进度」，净化逻辑在 Task 9 补。

`src/App.tsx` 增加 `sourceReader` view 分支。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/pages/SourceReaderPage.test.tsx`
Expected: 1 个测试 PASS。跑全量 `npm test`。

- [ ] **Step 5: 提交**

```bash
git add src/
git commit -m "feat: 书源阅读页（正文抓取、翻章、进度记忆）"
```

---

### Task 9: 正文净化、错误态与打磨

**Files:**
- Modify: `src/services/bookSourceEngine.ts`（净化）
- Modify: `src/pages/SourceReaderPage.tsx`（净化应用 + 重试）
- Modify: `src/services/bookSourceEngine.test.ts`
- Docs: `README.md`（书源使用说明）

**Interfaces:**
- Consumes: Task 8 全部
- Produces:
  - `export function purifyContent(html: string, replaceRules?: string[]): string` — 移除常见广告/脚本节点（`script`、`style`、`ins`、`iframe`），并应用书源 JSON 中可选的 `purify`/`replace` 替换规则（若书源提供）。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { purifyContent } from "./bookSourceEngine";

it("strips scripts and ad nodes", () => {
  const out = purifyContent(`<div>正文<script>alert(1)</script><ins>广告</ins>继续</div>`);
  expect(out).not.toContain("alert");
  expect(out).not.toContain("广告");
  expect(out).toContain("正文");
  expect(out).toContain("继续");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 新增测试 FAIL（`purifyContent` 未导出）。

- [ ] **Step 3: 实现净化**

`bookSourceEngine.ts` 追加：
```ts
const REMOVE_SELECTORS = ["script", "style", "ins", "iframe", "noscript", "button", "footer", ".ad", ".ads", ".advert", "#ad"];

export function purifyContent(html: string, replaceRules?: string[]): string {
  const doc = new JSDOM(`<div id="__purify__">${html}</div>`).window.document;
  const root = doc.getElementById("__purify__")!;
  for (const sel of REMOVE_SELECTORS) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  let out = (root.innerHTML ?? "").trim();
  if (replaceRules) {
    for (const rule of replaceRules) {
      if (rule.startsWith("##")) {
        const parts = rule.slice(2).split("##");
        out = out.replace(new RegExp(parts[0], "g"), parts[1] ?? "");
      }
    }
  }
  return out;
}
```

`SourceReaderPage.tsx`：抓取到 `text` 后调用 `purifyContent(text, (src as any).purify)` 再存 content；抓取失败提供「重试」按钮（`loadChapter(chapter)`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 全部 PASS。跑全量 `npm test`。

- [ ] **Step 5: 更新 README**

`README.md` 追加「书源」一节：如何获取 legado 书源 JSON、粘贴添加、搜索与在线阅读说明、已知限制（需联网、规则可能随网站改版失效）。

- [ ] **Step 6: 冒烟 + 提交**

Run: `npm test` 全绿；`cargo test` 全绿；`npm run build` 通过。
```bash
git add .
git commit -m "feat: 书源正文净化与打磨"
```

---

## 已知限制（记录于 spec 附录）

- `@js:` 表达式在 WebView 内 `new Function` 执行，当前 CSP `script-src 'self'` 可能拦截 `eval` 类执行——若书源大量使用 `@js:`，需在本功能落地时对书源页面放宽 CSP 并评估安全影响（计划内未自动处理，作为已知限制记录）。
- 正文净化采用通用广告节点过滤 + 可选替换规则，无法覆盖所有站点；以大多数书源可读为准。
- `nextContentUrl`/`nextTocUrl` 分页逻辑按「单页单章」实现；多页分章的书源（需连续翻页拼章）暂不支持。
- 音频书源（bookSourceType=1）不支持。
