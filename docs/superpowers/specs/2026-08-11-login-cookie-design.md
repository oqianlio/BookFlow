# 子项目4：登录/Cookie 会话设计文档

日期：2026-08-11
状态：已批准

## 1. 背景与目标

部分 legado 书源需要登录（`loginUrl`/`loginUi` 字段）或依赖会话 Cookie（`enabledCookieJar`）。当前「枕书」的 `http_get` 每次独立请求，无 Cookie 会话；书源 `httpHeaders` 里的 Cookie 是用户手填静态值。为对齐 legado 3.0，本子项目实现：

1. **Cookie 会话持久化**：reqwest `cookie_store` 特性 + 按书源域名的 cookie jar，请求自动带/存 Cookie。
2. **登录支持**：书源有 `loginUrl` 时，用 Tauri 新窗口（WebView2）加载登录页，用户登录后 Rust 侧请求吸收 Set-Cookie，后续书源请求自动携带。

**参考**：legado-md3 `help/http/CookieStore.kt`、`Cookie.kt`、`ui/login/*`（登录界面）、书源 `loginUrl`/`loginUi`/`enabledCookieJar`/`header` 字段。

## 2. 非目标

- 不实现 legado 的 `loginUi` 动态表单配置（复杂 UI 描述语言）—— 用 WebView 加载 `loginUrl` 直接登录。
- 不实现多账号/账号管理界面。
- 不实现 Cookie 手动编辑 UI（书源 `header` 里手填 Cookie 仍可用，覆盖 cookie_store）。

## 3. 技术架构

```
Rust (net.rs)                            Tauri WebView
┌──────────────────────────┐             ┌────────────────────┐
│ reqwest cookie_store jar  │             │ 登录窗口（新 webview）│
│  · 按书源域名 cookie jar   │  http_get  │  · 加载 loginUrl      │
│  · 请求自动带/存 Set-Cookie│◄──────────►│  · 用户登录           │
│  · cookie jar 持久化文件   │             │  · 登录后关闭         │
└──────────────────────────┘             └────────────────────┘
```

- Rust：reqwest `Client::builder().cookie_provider(jar)`，jar 持久化到应用数据目录 `cookies/<域名>.json`（或单文件 `cookies.json`）。
- `http_get` 命令增加可选 `cookie_jar: Option<String>` 参数（书源域名/标识），有则用该书源 jar。
- 登录：新 Tauri 窗口加载 `loginUrl`；用户登录后窗口触发关闭/事件，Rust 对登录域名发一次请求吸收 Set-Cookie 到该 jar。

## 4. Rust 侧改动

### 4.1 reqwest cookie_store

`Cargo.toml`：`reqwest = { version = "0.13.4", features = ["blocking", "cookie_store"] }`。
`cookie_store` crate（reqwest 传递依赖）提供 `CookieStore` + `CookieStoreMutex`，支持从文件加载/保存。

### 4.2 cookie jar 管理（`net.rs` 或新 `src-tauri/src/cookies.rs`）

```rust
pub struct CookieJarManager {
    dir: PathBuf, // app_data_dir/cookies
}
impl CookieJarManager {
    pub fn new(app_data_dir: &Path) -> Self;
    pub fn jar_for(&self, key: &str) -> Arc<CookieStoreMutex>; // key = 书源域名/标识
    // 从 <dir>/<sanitized key>.json 加载，或新建；保存由 reqwest 写回
}
```

- jar 文件名由 key 清洗（`|`, `/`, `\`, `:` → `_`）。
- `http_get` 增加 `cookie_jar: Option<String>` 参数：有则 `client.cookie_provider(jar_for(key))`，无则独立客户端（现状）。

### 4.3 登录窗口命令

```rust
#[tauri::command]
pub async fn open_login_window(url: String, cookie_jar: String, app: tauri::AppHandle) -> Result<(), String>;
```
- 新建 Tauri WebviewWindow（800x600）加载 `url`。
- 监听窗口关闭事件 → 对该 url 域名发一次 `http_get`（或直接请求首页）吸收 Set-Cookie 到 jar。
- 前端书源页调用此命令。

## 5. 前端改动

- 书源 JSON 增加 `loginUrl` 读取：书源页/阅读页检测到书源有 `loginUrl` 时，显示「登录」按钮。
- 点击 → `invoke("open_login_window", { url: loginUrl, cookieJar: <书源域名> })`。
- `httpGet` 调用链：书源请求传 `cookieJar`（书源 `bookSourceUrl` 域名）。

## 6. 文件改动

- `src-tauri/Cargo.toml`（reqwest cookie_store）
- `src-tauri/src/net.rs` 或新建 `src-tauri/src/cookies.rs`（jar 管理）
- `src-tauri/src/commands.rs`（http_get 加 cookie_jar 参数；open_login_window 命令）
- `src-tauri/src/lib.rs`（注册命令、初始化 jar manager）
- `src/services/api.ts`（httpGet 加 cookieJar；openLoginWindow）
- `src/pages/SourceBookPage.tsx` / `SourceReaderPage.tsx`（登录按钮）
- 测试：Rust cookie jar 加载/保存、命令参数；前端登录按钮

## 7. 测试

- Rust：cookie jar 创建/加载/保存（tempdir）；`http_get` 带 cookie_jar 时注入 jar（可测构造逻辑）。
- 前端：书源有 loginUrl 时显示登录按钮；httpGet 传 cookieJar。
- 现有测试保持绿：`npm test`（151 个）+ `cargo test`。

## 8. 交付文件

- `src-tauri/src/cookies.rs`（新建，jar 管理）
- `src-tauri/src/net.rs` / `commands.rs` / `lib.rs` / `Cargo.toml`
- `src/services/api.ts`
- `src/pages/SourceBookPage.tsx` / `SourceReaderPage.tsx`
- 测试：`src-tauri/tests/cookies_test.rs`、前端组件测试

## 9. 已知限制

- 登录窗口为整页 WebView 登录；书源 `loginUi` 动态表单配置不解析。
- Cookie 按书源域名隔离，同一域名多书源共享 jar。
- 书源 `header` 手填 Cookie 优先于 cookie_store（`build_request` 已注入 header，reqwest 的 cookie_provider 对显式 Cookie 头有协商——需验证优先级；若冲突，显式 header 优先）。
- 登录后的 Cookie 需一次请求吸收；某些站点登录后首个请求不返回 Set-Cookie 的，可能需刷新 cookie jar（后续优化）。
