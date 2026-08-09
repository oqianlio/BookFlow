# 真实书源核心兼容设计文档

日期：2026-08-07
状态：已批准

## 1. 背景与目标

「阅卷」书源功能已在本地模拟书库上验证全流程可用。但真实书源（legado 生态）普遍存在三类兼容性缺口，导致多数纯 CSS 书源无法开箱即用：

1. **POST 搜索**：部分书源搜索用 POST（form-urlencoded），当前 `http_get` 只支持 GET。
2. **反爬**：真实站点常拒绝非浏览器请求，当前 `http_get` 未注入默认 UA。
3. **规则语法**：真实书源常用 `tag.x` 索引选择器与 `||` 多规则回退，当前引擎不支持。

**目标**：让大多数不含 `@js:` 的纯 CSS 书源开箱即用。

**非目标**：
- 不支持 `@js:` 表达式执行（维持 CSP 安全现状，见 spec 2026-08-07-book-sources-design.md §12）
- 不支持 legado 高级语法（`@css:` 内嵌 JS、复杂正则替换的高级变体）
- 不处理需登录 Cookie 的高级书源（书源 JSON 自带 header/Cookie 时透传）

## 2. 技术架构

```
前端规则引擎 (WebView)                    Rust 网络层
┌──────────────────────────┐   http_get   ┌────────────────────────┐
│ · || 多规则回退           │ ───────────► │ · GET/POST              │
│ · tag.x 索引选择器        │  HTML 字符串  │ · 默认浏览器 UA          │
│ · 属性取值(@html/@text等)  │              │ · 书源 header 透传       │
└──────────────────────────┘              └────────────────────────┘
```

- Rust 只扩展网络能力；规则语法扩展全在前端引擎。
- 书源 JSON 的 `httpHeaders` / `httpUserAgent` 由前端解析后传入 `httpGet`；未声明 UA 时 Rust 注入默认浏览器 UA。

## 3. 网络层增强（Rust `src-tauri/src/net.rs`）

### 3.1 `http_get` 命令签名（向后兼容）

```rust
#[tauri::command]
pub async fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    method: Option<String>,      // "GET"（默认）| "POST"
    body: Option<String>,        // POST 请求体
    content_type: Option<String> // POST 的 Content-Type，默认 application/x-www-form-urlencoded
) -> Result<String, String>
```

旧调用（url/headers/timeout_ms）不变，新参数均为 `Option`。

### 3.2 默认浏览器 UA

- 当 `headers` 中未含 `User-Agent`/`user-agent` 时，注入：
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
- 书源 JSON 声明的 UA（经 headers 传入）优先。

### 3.3 POST 支持

- `method == "POST"` 且 `body` 非空时：`client.post(url).header(content_type, ...).body(body)`。
- 默认 Content-Type 为 `application/x-www-form-urlencoded`。
- GET（默认）行为完全不变。

## 4. 规则引擎增强（前端 `src/services/bookSourceEngine.ts`）

### 4.1 `||` 多规则回退

- 规则字符串含 `||` 时，按顺序尝试每个子规则，**第一个非空结果胜出**。
- 应用于：
  - `extractSingle(doc, rule, ctx)` 的整条规则
  - `extractList` 中 `extractFromElement` 的每条 itemRules
- 实现：拆分子规则前先处理 `||`；子规则用现有 `parseRule` 逻辑。

### 4.2 `tag.x` 索引选择器

- legado 语义：`tag.<tagName>.<index>@<attr>`，如 `tag.a.1@href` = "第 2 个 a 标签的 href"（**0 基索引**）。
- 在 `extractFromElement`（列表内）与 `extractSingle`（文档级）中解析：
  - `tag.a.1` → `node.querySelectorAll("a")[1]`
  - 越界返回空字符串
- 无属性后缀时默认 `@text`。

### 4.3 属性取值（现状保持并确认）

已支持 `@text` / `@ownText` / `@all` / `@html` / `@href` / `@src` / 任意属性；本设计不新增，仅确保与 `tag.x` 组合可用。

## 5. 前端调用链（`src/services/api.ts` + 书源页面）

- `httpGet(url, headers, timeoutMs)` 封装更新为支持新参数：`httpGet(url, headers?, timeoutMs?, method?, body?, contentType?)`。
- `searchSource`：把书源 `httpHeaders` 传入 `httpGet`；若 `searchUrl` 含 legado 的 POST 结构，解析出 method/body 传给 `httpGet`。
  - legado POST 搜索写法：`searchUrl = "https://site/search.php,{"method":"POST","body":"searchkey={{key}}&type=all"}"` —— 即**逗号分隔的 URL + JSON 选项**。前端检测 `searchUrl` 中是否存在 `,{`：若是，拆出 `url` 与选项 JSON（`method`/`body`），把 `body` 中的 `{{key}}` 替换为关键词，传给 `httpGet(url, headers, undefined, method, body)`。
- `fetchChapter` / 书籍/目录抓取：同样透传 `httpHeaders`。

## 6. 测试

### Rust（`src-tauri/tests/net_test.rs`）

- POST 请求构造逻辑（用可测的请求构建函数，不真发网络）
- 默认 UA 注入逻辑（未声明时注入、声明时优先）
- 既有 decode 测试保持

### 前端 Vitest（`bookSourceEngine.test.ts`）

- `||` 回退：第一条子规则无结果时用第二条；第一条有结果时用它
- `tag.x`：`tag.a.1@href` 取第 2 个 a；越界返回空
- 组合：`||` 内含 `tag.x`

### 真实站点冒烟

- 用已确认可访问的书源（如 jiqinw，带 UA）写一个真实 HTTP 的 vitest 用例（搜索→目录→正文），标记为可跳过（`describe.skipIf`）以便离线环境不误报失败。

## 7. 交付文件

- `src-tauri/src/net.rs`（http_get 扩展）
- `src/services/api.ts`（httpGet 新参数）
- `src/services/bookSourceEngine.ts`（|| 与 tag.x）
- `src/services/bookSourceEngine.test.ts`
- `src-tauri/tests/net_test.rs`
- 真实冒烟测试（新文件或并入现有）

## 8. 已知限制

- 不含 `@js:` 执行（CSP 安全，维持现状）
- `tag.x` 仅单层索引，不支持 legado 高级语法
- Cloudflare 等强反爬书源仍需书源自带 header/Cookie
