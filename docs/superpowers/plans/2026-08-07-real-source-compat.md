# 真实书源核心兼容实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让大多数不含 `@js:` 的纯 CSS 书源开箱即用：Rust `http_get` 支持 POST + 默认浏览器 UA，前端规则引擎支持 `||` 多规则回退与 `tag.x` 索引选择器。

**Architecture:** Rust 网络层扩展（POST/UA）与前端规则引擎扩展（`||`/`tag.x`）分离。前端解析书源 JSON 的 header/UA/POST 结构后传入 `httpGet` 新参数；Rust 侧负责发起请求与默认 UA 注入。

**Tech Stack:** Rust (reqwest), React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-07-real-source-compat-design.md`

## Global Constraints

- `http_get` 命令签名向后兼容：`(url, headers, timeout_ms, method?, body?, content_type?)`，旧调用不变。
- 默认浏览器 UA：书源未声明 UA 时注入 Chrome UA；书源 header 中 UA 优先。
- `||` 多规则：顺序尝试每个子规则，第一个非空结果胜出。
- `tag.x` 索引：0 基索引，`tag.a.1@href` = 第 2 个 a 标签的 href；越界返回空。
- legado POST 搜索写法：`searchUrl = "URL,{...json...}"`，前端拆分 URL 与选项。
- 不支持 `@js:` 执行（维持 CSP 安全现状）。
- 现有测试保持绿：`npm test`（62 个）+ `cargo test`（24 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: Rust `http_get` 支持 POST 与默认浏览器 UA

**Files:**
- Modify: `src-tauri/src/net.rs`
- Modify: `src-tauri/src/lib.rs`（注册命令参数，若需要）
- Test: `src-tauri/tests/net_test.rs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `pub async fn http_get(url: String, headers: Option<HashMap<String, String>>, timeout_ms: Option<u64>, method: Option<String>, body: Option<String>, content_type: Option<String>) -> Result<String, String>`
  - `pub const DEFAULT_UA: &str` — Chrome 120 UA 字符串
  - `pub fn build_request(method: &str, url: &str, headers: &HashMap<String,String>, body: Option<&str>, content_type: Option<&str>) -> reqwest::blocking::RequestBuilder` — 可测的请求构造函数（从 http_get 中拆出，便于单测 UA 注入与 POST）

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/net_test.rs` 追加：
```rust
use std::collections::HashMap;
use yd_lib::net::{build_request, DEFAULT_UA};

#[test]
fn injects_default_ua_when_absent() {
    let client = reqwest::blocking::Client::new();
    let req = build_request("GET", "http://example.com", &HashMap::new(), None, None)
        .build()
        .unwrap();
    let ua = req.headers().get(reqwest::header::USER_AGENT).unwrap().to_str().unwrap();
    assert_eq!(ua, DEFAULT_UA);
}

#[test]
fn respects_source_ua() {
    let client = reqwest::blocking::Client::new();
    let mut h = HashMap::new();
    h.insert("User-Agent".into(), "MyCustomUA/1.0".into());
    let req = build_request("GET", "http://example.com", &h, None, None).build().unwrap();
    let ua = req.headers().get(reqwest::header::USER_AGENT).unwrap().to_str().unwrap();
    assert_eq!(ua, "MyCustomUA/1.0");
}

#[test]
fn post_with_body_and_content_type() {
    let client = reqwest::blocking::Client::new();
    let mut h = HashMap::new();
    h.insert("User-Agent".into(), DEFAULT_UA.into());
    let req = build_request("POST", "http://example.com/search", &h, Some("q=x"), Some("application/x-www-form-urlencoded"))
        .build().unwrap();
    assert_eq!(req.method(), reqwest::Method::POST);
    let ct = req.headers().get(reqwest::header::CONTENT_TYPE).unwrap().to_str().unwrap();
    assert_eq!(ct, "application/x-www-form-urlencoded");
}
```
> 注：`build_request` 需能接收与 http_get 相同的 header 集合并构造 reqwest builder。`reqwest` 已在 Cargo.toml。测试用 `client` 仅构造不发送。

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test net_test`
Expected: 编译失败（`build_request`/`DEFAULT_UA` 不存在）。

- [ ] **Step 3: 实现 net.rs 扩展**

```rust
use std::collections::HashMap;

pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;
pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub fn decode_body(bytes: &[u8], _charset_hint: Option<&str>) -> Result<String, String> {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    Ok(cow.into_owned())
}

pub fn build_request(
    method: &str,
    url: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
    content_type: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let client = reqwest::blocking::Client::new();
    let mut req = if method.eq_ignore_ascii_case("POST") {
        let b = client.post(url);
        let ct = content_type.unwrap_or("application/x-www-form-urlencoded");
        b.header(reqwest::header::CONTENT_TYPE, ct)
            .body(body.unwrap_or("").to_string())
    } else {
        client.get(url)
    };
    let mut has_ua = false;
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("user-agent") { has_ua = true; }
        req = req.header(k, v);
    }
    if !has_ua {
        req = req.header(reqwest::header::USER_AGENT, DEFAULT_UA);
    }
    req
}

#[tauri::command]
pub async fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)))
            .build()
            .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
        let empty = HashMap::new();
        let h = headers.as_ref().unwrap_or(&empty);
        let mut req = if method.as_deref().unwrap_or("GET").eq_ignore_ascii_case("POST") {
            let ct = content_type.as_deref().unwrap_or("application/x-www-form-urlencoded");
            client.post(&url).header(reqwest::header::CONTENT_TYPE, ct).body(body.unwrap_or_default())
        } else {
            client.get(&url)
        };
        let mut has_ua = false;
        for (k, v) in h {
            if k.eq_ignore_ascii_case("user-agent") { has_ua = true; }
            req = req.header(k, v);
        }
        if !has_ua {
            req = req.header(reqwest::header::USER_AGENT, DEFAULT_UA);
        }
        let resp = req.send().map_err(|e| format!("网络请求失败: {e}"))?;
        let bytes = resp.bytes().map_err(|e| format!("读取响应失败: {e}"))?;
        decode_body(&bytes, None)
    })
    .await
    .map_err(|e| format!("后台任务失败: {e}"))?
}
```
> 注：`build_request` 返回的 builder 用 `Client::new()` 构造（测试用）；`http_get` 内部用带超时的 client 重建同一逻辑。为避免重复，可在 `build_request` 接受 client 参数，但为保持测试简单，两处逻辑一致即可。若实现者倾向单一函数，可让 `build_request(client, ...)` 接收 client——以能测为准。

`src-tauri/src/lib.rs` 的 `generate_handler!` 中 `http_get` 已注册，无需改（命令参数变化不影响注册）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --test net_test`
Expected: 5 个测试 PASS（2 旧 + 3 新）。另跑 `cargo test` 全量（24 保持）与 `cargo check`。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/
git commit -m "feat: http_get 支持 POST 与默认浏览器 UA"
```

---

### Task 2: 前端规则引擎 `||` 多规则回退

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Test: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Consumes: Task 之前已有 `parseRule`, `extractSingle`, `extractFromElement`
- Produces:
  - `export function splitAlternatives(rule: string): string[]` — 按 `||` 拆分，保留 trim。供 extractSingle/extractFromElement 使用。
  - `extractSingle` 与 `extractFromElement` 内部：规则含 `||` 时顺序尝试各子规则，第一个非空结果胜出。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { splitAlternatives, extractSingle } from "./bookSourceEngine";

it("splits || alternatives", () => {
  expect(splitAlternatives("a@text||b@text")).toEqual(["a@text", "b@text"]);
  expect(splitAlternatives("single@text")).toEqual(["single@text"]);
});

it("uses first non-empty alternative", () => {
  const doc = parseHtml(`<div><span class="a"></span><p class="b">命中</p></div>`);
  const out = extractSingle(doc, "span.a@text||p.b@text");
  expect(out).toBe("命中");
});

it("falls through when first alternative empty", () => {
  const doc = parseHtml(`<div><p class="b">只有B</p></div>`);
  const out = extractSingle(doc, "span.a@text||p.b@text");
  expect(out).toBe("只有B");
});

it("handles tag.x inside alternatives", () => {
  const doc = parseHtml(`<div><a class="x" href="/1">一</a><a class="x" href="/2">二</a></div>`);
  const out = extractSingle(doc, "tag.a.0@href||tag.a.1@href", { baseUrl: "https://ex.com" });
  expect(out).toBe("https://ex.com/1");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `splitAlternatives` 不存在 + 现有 `||` 规则按字面处理导致 FAIL。

- [ ] **Step 3: 实现 splitAlternatives + 接入**

`bookSourceEngine.ts` 追加：
```ts
export function splitAlternatives(rule: string): string[] {
  return rule.split("||").map((s) => s.trim()).filter((s) => s.length > 0);
}
```

`extractSingle` 开头（解析前）：
```ts
const alts = splitAlternatives(rule);
if (alts.length > 1) {
  for (const alt of alts) {
    const v = extractSingle(doc, alt, ctx);
    if (v) return v;
  }
  return "";
}
```

`extractFromElement` 开头：
```ts
const alts = splitAlternatives(rule);
if (alts.length > 1) {
  for (const alt of alts) {
    const v = extractFromElement(el, alt, baseUrl);
    if (v) return v;
  }
  return "";
}
```
> 注：`extractList` 的 xpath 分支调 `extractFromElement(node, rule)` 不带 baseUrl，与现状一致；CSS 分支传 baseUrl。`||` 在两种分支都生效（因都在 extractFromElement 内部处理）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 新增 4 个测试 + 现有全过。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: 规则引擎支持 || 多规则回退"
```

---

### Task 3: 前端规则引擎 `tag.x` 索引选择器

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Test: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Consumes: `parseAttrRule` 已解析 CSS 选择器与属性后缀
- Produces:
  - `export function resolveTagIndex(selector: string, scope: Document | Element): Element | null` — 解析 `tag.<tagName>.<index>` 形式选择器，0 基索引取第 index 个元素；非 `tag.` 前缀返回 null。
  - `extractFromElement` 与 `extractSingle` 的 CSS 分支：选择器以 `tag.` 开头时用 `resolveTagIndex` 取值。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { resolveTagIndex, extractSingle, extractList } from "./bookSourceEngine";

it("resolves tag.x index selector", () => {
  const doc = parseHtml(`<div><a class="x" href="/1">一</a><a class="x" href="/2">二</a><a class="x" href="/3">三</a></div>`);
  const el = doc.querySelector("div")!;
  const second = resolveTagIndex("tag.a.1", el);
  expect(second?.getAttribute("href")).toBe("/2");
});

it("returns null for out-of-range tag index", () => {
  const doc = parseHtml(`<div><a href="/1">一</a></div>`);
  const el = doc.querySelector("div")!;
  expect(resolveTagIndex("tag.a.5", el)).toBeNull();
});

it("extracts via tag.x in extractSingle", () => {
  const doc = parseHtml(`<div><a href="/1">一</a><a href="/2">二</a></div>`);
  const href = extractSingle(doc, "tag.a.1@href", { baseUrl: "https://ex.com" });
  expect(href).toBe("https://ex.com/2");
});

it("extracts via tag.x in extractList item rules", () => {
  const doc = parseHtml(`<ul><li><a class="t" href="/a">甲</a><span class="t">乙</span></li><li><a class="t" href="/c">丙</a><span class="t">丁</span></li></ul>`);
  const list = extractList(doc, "ul > li", { url: "tag.a.0@href", name: "tag.a.0@text" }, { baseUrl: "https://ex.com" });
  expect(list.length).toBe(2);
  expect(list[0].url).toBe("https://ex.com/a");
  expect(list[1].url).toBe("https://ex.com/c");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `resolveTagIndex` 不存在 + `tag.a.1@href` 按普通 CSS 处理 FAIL。

- [ ] **Step 3: 实现 resolveTagIndex + 接入**

`bookSourceEngine.ts` 追加：
```ts
export function resolveTagIndex(selector: string, scope: Document | Element): Element | null {
  const m = selector.match(/^tag\.([a-zA-Z][\w-]*)\.(\d+)$/);
  if (!m) return null;
  const tag = m[1];
  const index = parseInt(m[2], 10);
  const nodes = scope.querySelectorAll(tag);
  return nodes[index] ?? null;
}
```

`extractSingle` CSS 分支（替换 `doc.querySelector(parsed.value)` 处）：
```ts
if (parsed.value.startsWith("tag.")) {
  const node = resolveTagIndex(parsed.value, doc);
  return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
}
if (!parsed.value) return "";
const node = doc.querySelector(parsed.value);
return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
```

`extractFromElement`：
```ts
if (!parsed.value) {
  return finalize(nodeValue(el, parsed.attr), parsed.attr, baseUrl);
}
if (parsed.value.startsWith("tag.")) {
  const node = resolveTagIndex(parsed.value, el);
  return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, baseUrl) : "";
}
const node = el.matches(parsed.value) ? el : el.querySelector(parsed.value);
return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, baseUrl) : "";
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 新增 4 个测试 + 现有全过（含 Task 2 的 `||` + `tag.x` 组合）。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: 规则引擎支持 tag.x 索引选择器"
```

---

### Task 4: 前端 httpGet 新参数 + POST 搜索解析

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/pages/DiscoverPage.tsx`（searchSource 用新参数）
- Modify: `src/pages/SourceReaderPage.tsx` / `SourceBookPage.tsx`（透传 httpHeaders，若当前未透传）
- Test: `src/services/bookSourceEngine.test.ts` 或新文件（解析逻辑纯函数）

**Interfaces:**
- Consumes: Task 1 `http_get` 新参数；Task 2-3 引擎
- Produces:
  - `export async function httpGet(url: string, headers?: Record<string,string>, timeoutMs?: number, method?: string, body?: string, contentType?: string): Promise<string>`
  - `export function parseSearchUrl(searchUrl: string, key: string): { url: string; method?: string; body?: string }` — 解析 legado 的 `URL,{...}` POST 结构；`body` 中 `{{key}}` 已替换。无 `,{` 时返回 `{ url: searchUrl.replace("{{key}}", encodeURIComponent(key)) }`。

- [ ] **Step 1: 写失败的测试**

新建 `src/services/searchUrl.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { parseSearchUrl } from "./bookSourceEngine";

describe("parseSearchUrl", () => {
  it("handles plain GET url with {{key}}", () => {
    const r = parseSearchUrl("https://ex.com/search?q={{key}}", "三体");
    expect(r.url).toBe("https://ex.com/search?q=" + encodeURIComponent("三体"));
    expect(r.method).toBeUndefined();
  });

  it("parses legado POST structure", () => {
    const r = parseSearchUrl('https://ex.com/search.php,{"method":"POST","body":"searchkey={{key}}&s=all"}', "三体");
    expect(r.url).toBe("https://ex.com/search.php");
    expect(r.method).toBe("POST");
    expect(r.body).toBe("searchkey=" + encodeURIComponent("三体") + "&s=all");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/searchUrl.test.ts`
Expected: `parseSearchUrl` 不存在 FAIL。

- [ ] **Step 3: 实现 parseSearchUrl（放 bookSourceEngine.ts）+ api.ts + 调用点**

`bookSourceEngine.ts` 追加：
```ts
export function parseSearchUrl(searchUrl: string, key: string): { url: string; method?: string; body?: string } {
  const commaIdx = searchUrl.indexOf(",{");
  if (commaIdx === -1) {
    return { url: searchUrl.replace("{{key}}", encodeURIComponent(key)) };
  }
  const url = searchUrl.slice(0, commaIdx);
  try {
    const opts = JSON.parse(searchUrl.slice(commaIdx + 1));
    const body = (opts.body ?? "").replace("{{key}}", encodeURIComponent(key));
    return { url, method: opts.method ?? "POST", body };
  } catch {
    return { url: searchUrl.replace("{{key}}", encodeURIComponent(key)) };
  }
}
```

`api.ts`：
```ts
export async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number,
  method?: string,
  body?: string,
  contentType?: string,
): Promise<string> {
  return invoke<string>("http_get", {
    url, headers: headers ?? null, timeoutMs: timeoutMs ?? null,
    method: method ?? null, body: body ?? null, contentType: contentType ?? null,
  });
}
```

`DiscoverPage.tsx` `searchSource`：
```ts
const parsed = parseSearchUrl(src.searchUrl ?? "", key);
const html = await httpGet(parsed.url, src.httpHeaders, undefined, parsed.method, parsed.body);
```
> 若 src.httpHeaders 未定义（无 header），传 undefined 即可（httpGet 默认 null）。

`SourceBookPage.tsx` / `SourceReaderPage.tsx`：确认 `httpGet(bookUrl, s.httpHeaders, ...)` 已透传 header（当前实现已传）。若发现某处未传，补上。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/searchUrl.test.ts`
Expected: 2 个测试 PASS。跑 `npm test` 全量（62+2）与 `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/
git commit -m "feat: httpGet 新参数与 legado POST 搜索解析"
```

---

### Task 5: 真实站点冒烟测试（可跳过）

**Files:**
- Create: `src/services/realSourceCompat.test.ts`
- Modify: 无

**Interfaces:**
- Consumes: Task 2-4 全部
- Produces: 真实 HTTP 冒烟用例，验证带 UA 的真实书源搜索→目录→正文全流程；`describe.skipIf(无网络)` 避免离线误报。

- [ ] **Step 1: 写测试**

`src/services/realSourceCompat.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { parseHtml, extractList, extractSingle } from "./bookSourceEngine";

const JIQINW = {
  bookSourceUrl: "http://www.jiqinw.com",
  searchUrl: "http://www.jiqinw.com/plus/hsearch.php?q={{key}}",
  ruleSearch: { bookList: "ul.list_article > li", name: "h2 a@text", author: "p@text", bookUrl: "h2 a@href" },
  ruleToc: { chapterList: "ul.list_article > li > a", chapterName: "@text", chapterUrl: "@href" },
  ruleContent: { content: "#content@html" },
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const online = typeof process !== "undefined" && !!process.env.CI === false && navigator.onLine !== false;

describe.skipIf(!online)("real source jiqinw (smoke, needs network)", () => {
  it("searches and extracts books with UA header", async () => {
    const url = JIQINW.searchUrl.replace("{{key}}", encodeURIComponent("在线"));
    const resp = await fetch(url, { headers: { "User-Agent": UA } });
    const doc = parseHtml(await resp.text());
    const hits = extractList(doc, JIQINW.ruleSearch.bookList, {
      name: JIQINW.ruleSearch.name, author: JIQINW.ruleSearch.author, bookUrl: JIQINW.ruleSearch.bookUrl,
    }, { baseUrl: JIQINW.bookSourceUrl });
    expect(hits.length).toBeGreaterThan(0);
  }, 20000);
});
```
> 说明：真实站点可能改版或反爬，此测试标记为"可跳过"，不阻塞主流程。若实现时 jiqinw 已不可访问，可替换为 spec §6 提到的其他已确认站点，或保留 skipIf 结构并在文档中记录。

- [ ] **Step 2: 运行测试**

Run: `npx vitest run src/services/realSourceCompat.test.ts`
Expected: 有网时 1 个测试 PASS 或 skip；无网时 skip。

- [ ] **Step 3: 提交**

```bash
git add src/services/realSourceCompat.test.ts
git commit -m "feat: 真实书源冒烟测试"
```

---

## 已知限制（记录于 spec 附录）

- 不含 `@js:` 执行（CSP 安全，维持现状）
- `tag.x` 仅单层索引，不支持 legado 高级语法（`@css:` 内嵌 JS、复杂正则替换变体）
- Cloudflare 等强反爬书源仍需书源自带 header/Cookie
