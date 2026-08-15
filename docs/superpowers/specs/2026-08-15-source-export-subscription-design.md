# 复刻 legado 书源生态 R12：书源导出/复制/分享 + 远程订阅更新

日期：2026-08-15
状态：待批准
前置：书源管理/导入已完成（对齐原版）。

## 1. 目标

参照 legado 原版设计，补齐书源生态闭环：
1. **书源导出/复制/分享**：单个书源复制 JSON、导出 `.json` 文件、批量选择导出合集；书源管理页对齐原版布局（操作入口在书源列表项内）。
2. **远程书源订阅更新**：订阅一个远程书源仓库 URL（含多个书源的 .json），手动刷新时拉取并对比本地书源，自动新增 / 更新 / 删除，对齐原版「书源订阅」设计。

## 2. 背景与问题

书源生态需要流通：原版支持复制/分享书源 JSON（社区流通格式），并支持订阅远程仓库（书源合集定期更新）。当前枕书只有导入，无法导出分享，也无法订阅更新。

## 3. 非目标

- 不做可视化规则编辑（书源 JSON 仍文本编辑，原版编辑器后续）。
- 不做订阅自动定时刷新（原版有自动，本批手动刷新 + 记录 last_checked）。
- 不做二维码分享（桌面端复制文本/导出文件即可）。
- 不做网页转书源。

## 4. 架构

```
A. 书源导出（前端为主 + Rust 文件写入）
  - 复制单个书源 JSON：navigator.clipboard.writeText(JSON.stringify(source))
  - 导出 .json 文件：Rust 新命令 write_text_file(path, content)（或复用现有 fs 能力）
    - 单书源导出：content = JSON.stringify(source, null, 2)
    - 批量导出：content = JSON.stringify([...sources], null, 2)（合集格式，可再导入）
  - 文件选择用现有 plugin-dialog save 对话框（Tauri 2 save API）

B. 远程订阅更新（Rust 数据层 + 前端 UI）
  - 新表 source_subscriptions（订阅源）：id, name, url, last_checked_at
  - 刷新流程（Rust 命令）：
    sync_source_subscription(url) -> SyncResult { added, updated, removed, failed }
    - http_get(url) 拉取远程合集（复用 parseBookSourceCollection 逻辑？—— 解析在 TS。
      方案：Rust 只负责网络与落库，解析复用 TS？跨语言不便。
      更优：**刷新流程放前端**（复用 bookSourceImport.parseBookSourceCollection + httpGet），
      对比逻辑前端做，落库用现有 add/update/delete 命令 + 新 get_source_by_url 命令。
  - 因此：Rust 仅加 3 个命令：list_subscriptions / add_subscription / delete_subscription
    + 1 个辅助 get_source_by_url（供前端对比）。
    前端 sync 逻辑：拉取 → parse → 遍历对比 → 调 add/update/delete。
```

### 4.1 数据库（db.rs）

```sql
CREATE TABLE IF NOT EXISTS source_subscriptions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    last_checked_at INTEGER
);
```

函数：
- `add_subscription_db(conn, name, url) -> Result<i64>`
- `list_subscriptions_db(conn) -> Result<Vec<SubscriptionRow>>`（id/name/url/last_checked_at）
- `delete_subscription_db(conn, id) -> Result<()>`
- `get_source_by_url_db(conn, url) -> Result<Option<SourceRow>>`（订阅对比用）

### 4.2 Rust 命令

```rust
#[derive(serde::Serialize)] pub struct SubscriptionRow { id, name, url, last_checked_at }

#[tauri::command] add_subscription(url) -> Result<i64, String>        // 拉取一次拿 name（失败报错）
#[tauri::command] list_subscriptions() -> Result<Vec<SubscriptionRow>, String>
#[tauri::command] delete_subscription(id) -> Result<(), String>
#[tauri::command] get_source_by_url(url) -> Result<Option<SourceRow>, String>
#[tauri::command] write_text_file(path, content) -> Result<(), String>  // 导出文件
```

- `add_subscription`：用 rss::http_get_xml 类似的同步抓取（或 net），parse 出首个书源名作为订阅名（Rust 侧 JSON 解析 serde_json 找 bookSourceName）；失败报错不落库。
- `write_text_file`：std::fs::write，带路径创建父目录（可选，直接写用户选路径）。

### 4.3 前端 sync 流程（src/services/sourceSubscription.ts）

```ts
export interface SyncResult { added: number; updated: number; removed: number; failed: number }

export async function syncSubscription(sub: SubscriptionRow): Promise<SyncResult> {
  // 1. 拉取远程合集（复用 bookSourceImport 的解析）
  const text = await httpGet(sub.url, undefined, 20000);
  const remote = parseBookSourceCollection(text);
  // 2. 本地现有（按 url 建立 map）
  const local = await listBookSources();
  const localByUrl = new Map(local.map((s) => [s.url, s]));
  // 3. 对比
  let added = 0, updated = 0, failed = 0;
  const remoteUrls = new Set<string>();
  for (const rs of remote) {
    remoteUrls.add(rs.bookSourceUrl);
    const existing = localByUrl.get(rs.bookSourceUrl);
    if (existing) {
      // 更新：比较 json 是否变化（避免无谓写入）
      if (existing.json !== JSON.stringify(rs)) {
        await updateBookSource(existing.id, rs.bookSourceName, rs.bookSourceUrl, JSON.stringify(rs));
        updated++;
      }
    } else {
      await addBookSource(rs.bookSourceName, rs.bookSourceUrl, JSON.stringify(rs));
      added++;
    }
  }
  // 4. 删除本地有但远程已移除的书源？—— 原版默认不删（用户本地可能有自加书源）。
  //    原版提供"删除失效书源"选项，本批默认不删，removed 恒 0（保留设计字段）。
  return { added, updated, removed: 0, failed };
}
```

- 前端调用后 `update_subscription_checked(sub.id)`：Rust 命令 `set_subscription_checked(id)` 更新 last_checked_at。

### 4.4 书源管理页 UI（对齐原版）

书源列表项操作区（现有：启用 checkbox / 调试 / 删除）追加：
- 「复制」：复制该书源 JSON 到剪贴板 → 提示"已复制"
- 「导出」：导出单个 .json 文件
- 顶部「导出全部」按钮：导出当前全部书源合集
- 新分区「订阅源」：添加订阅 URL、列表（名称 + 上次检查时间 + 刷新/删除）、刷新显示 SyncResult 提示

（原版把导出/分享放在书源项的操作菜单与批量选择；我们已有多选逻辑（import 确认用），导出全部用简单按钮即可，不引入批量选择导出以控制范围——批量导出=导出全部。）

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/db.rs` | source_subscriptions 表 + 4 函数 |
| `src-tauri/src/commands.rs` | 5 命令（add/list/delete subscription, get_source_by_url, write_text_file, set_subscription_checked） |
| `src-tauri/tests/db_test.rs` | 订阅表测试 |
| `src/services/api.ts` | 封装 |
| `src/services/sourceSubscription.ts` | sync 逻辑（新建） |
| `src/services/sourceSubscription.test.ts` | sync 测试（新建） |
| `src/components/BookSourceManager.tsx` | 复制/导出/导出全部 + 订阅源分区 |
| `src/components/BookSourceManager.test.tsx` | 适配 + 新增用例 |

## 6. 测试

- Rust：订阅表 CRUD、get_source_by_url、write_text_file。
- sourceSubscription：sync 新增/更新/跳过相同、远程失效不删、失败计数。
- BookSourceManager：复制按钮调用 clipboard、导出触发、订阅添加/刷新/删除 UI。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 7. 错误处理

- 订阅拉取失败/解析失败 → showError，last_checked_at 不更新。
- 导出文件写入失败 → showError。
- 剪贴板不可用（非安全上下文）→ fallback textarea 复制（简单方案：直接 try/catch 提示）。
- sync 中单个书源 add/update 失败 → failed++ 继续。
