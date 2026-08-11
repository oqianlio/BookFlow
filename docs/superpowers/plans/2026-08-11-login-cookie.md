# 子项目4：登录/Cookie 会话实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「枕书」实现 legado 书源的 Cookie 会话持久化与登录：reqwest cookie_store 按书源域名隔离 cookie jar，`http_get` 支持 `cookie_jar` 参数；书源有 `loginUrl` 时用 Tauri 新窗口登录并吸收 Set-Cookie。

**Architecture:** 新增 `src-tauri/src/cookies.rs`（CookieJarManager，按书源域名 jar 持久化到 app_data_dir/cookies）；`http_get` 增加 `cookie_jar` 可选参数（有则用该书源 jar）；新增 `open_login_window` 命令（Tauri WebViewWindow 加载 loginUrl，关闭后请求吸收 Set-Cookie）；前端书源页/阅读页加登录按钮。

**Tech Stack:** Rust (reqwest cookie_store, cookie_store crate), Tauri 2, React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-11-login-cookie-design.md`

## Global Constraints

- `http_get` 增加可选 `cookie_jar: Option<String>`（书源域名/标识）；有则 `client.cookie_provider(jar_for(key))`。
- Cookie jar 持久化到 `app_data_dir/cookies/<sanitized key>.json`，key 清洗（`|/\\:` → `_`）。
- `open_login_window(url, cookie_jar, app)`：新建 WebViewWindow 加载 url；窗口关闭后对该域名发一次请求吸收 Set-Cookie。
- 前端：书源有 `loginUrl` 时显示「登录」按钮；`httpGet` 调用链传 `cookieJar`（书源 `bookSourceUrl` 域名）。
- 现有测试保持绿：`npm test`（151 个）+ `cargo test`（27 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: Rust CookieJarManager + http_get cookie_jar 参数

**Files:**
- Create: `src-tauri/src/cookies.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/net.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/cookies_test.rs`

**Interfaces:**
- Produces:
  - `pub struct CookieJarManager { dir: PathBuf }`
  - `impl CookieJarManager { pub fn new(dir: PathBuf) -> Self; pub fn jar_for(&self, key: &str) -> Arc<CookieStoreMutex> }` — 从 `<dir>/<sanitized>.json` 加载或新建。
  - `pub fn sanitize_key(key: &str) -> String` — 清洗域名/标识为安全文件名。
  - `http_get` 增加 `cookie_jar: Option<String>` 参数；有则注入 jar。
  - `AppState` 增加 `cookies: CookieJarManager`。

- [ ] **Step 1: 写失败的测试**

`src-tauri/tests/cookies_test.rs`：
```rust
use std::fs;
use tempfile::tempdir;
use yd_lib::cookies::{CookieJarManager, sanitize_key};

#[test]
fn sanitizes_key_for_filename() {
    assert_eq!(sanitize_key("https://www.example.com/"), "https___www.example.com_");
    assert_eq!(sanitize_key("a|b\\c:d"), "a_b_c_d");
}

#[test]
fn jar_for_roundtrips_persistence() {
    let dir = tempdir().unwrap();
    let mgr = CookieJarManager::new(dir.path().to_path_buf());
    // jar 首次创建为空，不崩溃
    let jar = mgr.jar_for("example.com");
    drop(jar);
    // 再次获取同 key 不崩溃
    let _ = mgr.jar_for("example.com");
    fs::remove_dir_all(dir.path()).unwrap();
}
```
> 注：cookie_store 的 CookieStoreMutex 持文件句柄；jar_for 每次打开文件加载。测试验证创建/复用/文件名清洗。

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --test cookies_test`
Expected: 编译失败（cookies 模块不存在）。

- [ ] **Step 3: 实现 cookies.rs**

```rust
use cookie_store::CookieStoreMutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub fn sanitize_key(key: &str) -> String {
    key.chars().map(|c| if c == '|' || c == '/' || c == '\\' || c == ':' { '_' } else { c }).collect()
}

pub struct CookieJarManager {
    dir: PathBuf,
}

impl CookieJarManager {
    pub fn new(dir: PathBuf) -> Self {
        std::fs::create_dir_all(&dir).ok();
        Self { dir }
    }

    pub fn jar_for(&self, key: &str) -> Arc<CookieStoreMutex> {
        let file = self.dir.join(format!("{}.json", sanitize_key(key)));
        if let Ok(store) = CookieStoreMutex::load_from_file(&file) {
            Arc::new(store)
        } else {
            Arc::new(CookieStoreMutex::default())
        }
    }
}
```
> 注：cookie_store 的 `CookieStoreMutex::load_from_file`/`save_to_file` 用于持久化。reqwest 每次请求后需 `jar.save_to_file` 或依赖 reqwest 的 `cookie_provider` 自动写回——reqwest blocking client 用 `cookie_provider(Arc<CookieStoreMutex>)` 会在请求时写回。若 reqwest 不自动保存，需在 `http_get` 后手动 `jar.lock().unwrap().save_to_file`。实现者验证并处理。

`Cargo.toml`：`reqwest = { version = "0.13.4", features = ["blocking", "cookie_store"] }`，`cargo add cookie_store`。

`net.rs` 的 `http_get` 增加 `cookie_jar: Option<String>`，注入 jar：
```rust
// 在 spawn_blocking 内
let client_builder = reqwest::blocking::Client::builder()
    .timeout(...);
let client = match cookie_jar {
    Some(key) => {
        let jar = state_cookies.jar_for(&key); // 需从命令闭包捕获
        client_builder.cookie_provider(jar).build()
    }
    None => client_builder.build(),
};
```
> 注：`http_get` 目前无 State。需给 `http_get` 加 `state: State<AppState>` 以访问 `cookies` 管理器。AppState 增加 `cookies: CookieJarManager`。lib.rs setup 初始化 `CookieJarManager::new(app_data_dir.join("cookies"))`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --test cookies_test` + 全量 `cargo test`（27 保持）+ `cargo check`。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/
git commit -m "feat: Cookie jar 管理与 http_get cookie_jar 参数"
```

---

### Task 2: open_login_window 命令 + 登录窗口

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/api.ts`
- Modify: `src/pages/SourceBookPage.tsx` / `SourceReaderPage.tsx`
- Test: `src-tauri/tests/cookies_test.rs` 追加；前端组件测试

**Interfaces:**
- Produces:
  - `#[tauri::command] pub fn open_login_window(url: String, cookie_jar: String, app: tauri::AppHandle) -> Result<(), String>` — 新建 WebViewWindow 加载 url；窗口 on_closed 时对 url 域名发一次 `http_get`（用该书源 jar）吸收 Set-Cookie。
  - api.ts：`openLoginWindow(url: string, cookieJar: string): Promise<void>`；`httpGet` 加 `cookieJar?` 参数。
  - SourceBookPage/SourceReaderPage：书源有 `loginUrl` 时显示「登录」按钮 → `openLoginWindow(src.loginUrl, bookSourceUrl 域名)`。

- [ ] **Step 1: 写失败的测试**

前端 `SourceBookPage.test.tsx` 追加：书源 JSON 含 `loginUrl` 时显示「登录」按钮，点击调 `api.openLoginWindow`。
Rust：`open_login_window` 编译（窗口创建逻辑难单测；测命令存在 + 参数签名）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/SourceBookPage.test.tsx` + `cargo check`
Expected: 前端 FAIL（无登录按钮）；Rust 编译通过（命令新增）。

- [ ] **Step 3: 实现**

`commands.rs`：
```rust
#[tauri::command]
pub fn open_login_window(url: String, cookie_jar: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = tauri::WebviewWindowBuilder::new(&app, format!("login_{}", sanitize_key(&cookie_jar)), tauri::WebviewUrl::External(url.parse().map_err(|e| format!("URL 无效: {e}"))?))
        .title("书源登录")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| format!("打开登录窗口失败: {e}"))?;
    let cookie_jar = cookie_jar.clone();
    let state = app.state::<AppState>();
    let mgr = state.cookies.clone(); // 需 Clone；CookieJarManager 加 #[derive(Clone)]
    let jar_key = cookie_jar;
    let _ = window.on_closed(move || {
        // 关闭后对该域名发一次请求吸收 Set-Cookie
        let url = format!("https://{jar_key}/"); // 简化：域名首页
        // 实际应从书源 header/UA 构造，先发 GET
        let jar = mgr.jar_for(&jar_key);
        let client = reqwest::blocking::Client::builder()
            .cookie_provider(jar)
            .build();
        if let Ok(c) = client {
            let _ = c.get(&url).send();
        }
    });
    Ok(())
}
```
> 注：`CookieJarManager` 需 `#[derive(Clone)]`（内部 PathBuf，可 Clone）。`on_closed` 闭包捕获需 `move`；`jar_for` 在闭包内调用。窗口创建逻辑粗略，实现者按 Tauri 2 API 调整。

`api.ts`：
```ts
export async function openLoginWindow(url: string, cookieJar: string): Promise<void> {
  await invoke("open_login_window", { url, cookieJar });
}
// httpGet 加 cookieJar?: string → invoke cookieJar: cookieJar ?? null
```

`SourceBookPage.tsx`：解析书源后若 `src.loginUrl` 存在，工具栏显示「登录」按钮 → `openLoginWindow(src.loginUrl, new URL(src.bookSourceUrl).hostname)`。

`lib.rs`：注册 `open_login_window`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test` 全量 + `cargo check`；`npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/ src/services/api.ts src/pages/
git commit -m "feat: 书源登录窗口与 Cookie 注入"
```

---

## 已知限制（记录于 spec 附录）

- 登录窗口为整页 WebView 登录；`loginUi` 动态表单不解析。
- Cookie 按书源域名隔离，同域名多书源共享 jar。
- 书源 `header` 手填 Cookie 优先（实现时验证）。
- 登录后 Cookie 需一次请求吸收；部分站点首个请求不返回 Set-Cookie 的需刷新（后续优化）。
