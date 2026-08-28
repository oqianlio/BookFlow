# 修复报告：多智能体审查问题清零（2026-08-28）

> 范围：响应 `docs/FINAL-REVIEW-2025-08-16.md`（92 项）与 `docs/reevaluation-report-2025-08-16.md` 后续"查找问题"审查（6 维度：正确性/性能/风格/测试/错误处理/过度设计）的全部可安全处理发现。
> 工作方式：分 6 批修复，每批均通过机器验证（`tsc --noEmit` + `npx vitest run` + `cargo test --lib` + `cargo clippy --all-targets`）。
> 约定：**自本报告起，每次修复批次结束同步产出报告**（新增文件或追加本文件章节）。

## 最终状态

| 检查项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| `npx vitest run` | 582 通过 / 0 失败 / 5 跳过（环境门控：SOURCE_HEALTH/fullChain/tempVerify 等） |
| `cargo test --lib` | 39/39 通过 |
| `cargo clippy --all-targets` | 0 警告 |

---

## 第 0 批 · 测试套件回归修复（25 个失败 → 0）

**起因**：前批重构将 `httpGet` 收敛为选项对象签名（`HttpGetOptions | string`），测试中的位置参数 mock 与断言未同步。

| 文件 | 修复 |
|---|---|
| `src/pages/ReaderPage.source.test.tsx` | 新增 `urlOf(a)` 适配器（string 透传 / 对象取 `.url`）；10 处 `mockImplementation` 适配；3 处 `String(c[0])` 过滤改 `urlOf`；`c[6]` 断言改 `c[0].cookieJar` |
| `src/services/sourceVerify.test.ts` | mock 与断言迁移至选项对象 |
| `src/services/sourceToc.test.ts` | 2 处 mock + 2 处 `objectContaining` 断言 |
| `src/pages/ExplorePage.test.tsx` | 3 处断言 |
| `src/services/bookSourceImport.test.ts` | `{url, timeoutMs: 20000}` |
| `src/pages/SourceBookPage.test.tsx` | `c[0].cookieJar` |

验证：570/570 通过。

---

## 第 1 批 · Rust 紧急修复（Critical）+ clippy 清零

### Critical（崩溃 / 数据一致性）
| 位置 | 问题 | 修复 |
|---|---|---|
| `src-tauri/src/rss.rs` `civil_to_ts` | 月份索引 MDAY[month] 对 month=0/13 panic；未验证日期/时间范围 | 返回 `Option<i64>`，完整校验：year∈[1970,9999]、month∈[1,12]、按月+闰年的日范围、h/m/s 边界（s≤60）；`parse_rfc822`/`parse_iso8601` 直通；修复 `.split('.').next()?.parse().ok()` 截断链 |
| `src-tauri/src/rss.rs` | 无测试 | 新增 `#[cfg(test)]` 3 个测试（有效时间戳 + 非法值拒绝） |
| `src-tauri/src/db.rs` `now()` | `.expect()` 可被锁中毒触发 panic | 改 `.unwrap_or_default()` |
| `src-tauri/src/db.rs` | `delete_source`/`record_read`/`set_shelf_group_members`/`remove_shelf_items` 多语句无事务 | 包裹 `unchecked_transaction()` + `commit()` |

### clippy 17 → 0
- `commands.rs`：移除 5 处冗余闭包 `.map_err(friendly_unique_error)`；折叠 `if let Ok(Some(path))`；删除无意义 `let _ =`；`save_book_source_progress` 加 `#[allow(clippy::too_many_arguments)]`（IPC 契约决定 8 参）
- `net.rs`：`http_get` 同上允许 + 注释
- `lib.rs`：删 3 个冗余 `use tauri_plugin_*`
- `import.rs`：`init_db(app_data_dir.join("reader.db"))` 去多余借用
- `search.rs`：`.replace(['\n', '\r'], " ")`
- `tts.rs`：补 `impl Default for TtsEngine`；`match speak_platform` → `if let Ok(mut child)`；`(bytes.len()).div_ceil(3) * 4`

验证：cargo test 39/39，clippy 0 警告。

---

## 第 2 批 · 前端 Major（错误处理 / 统一 HTTP 通道）

| 编号 | 位置 | 问题 | 修复 |
|---|---|---|---|
| ST-1 | `src/services/sourceHealth.ts` | 健康检查绕过统一通道裸用 `fetch`，无 cookie jar / UA / 日志 | 搜索与正文两处改 `httpGet({url, headers: mergeUserAgent(...), timeoutMs: 8000, cookieJar: hostOf(...)})`；测试 mock 重签名 |
| EH-4 | `ReaderPage.tsx` / `SettingsPage.tsx` | 阅读设置保存失败静默吞掉 | `saveReadingSettings` 失败 `console.warn("[reader] …")`；`applyCustomTheme` 静默 catch → `showError`；`updateEyeCare` 浮动 Promise 补 `.catch` |
| EH-6 | `src/services/backup.ts` + `SettingsPage.tsx` | 备份恢复部分失败被掩盖 | `importBackupData` 返回值新增 `failed: {sources, shelf, progress, settings}` 计数；完成提示显示"⚠ N 项失败（…）"明细 |
| ST-2(部分) | `ReaderPage.tsx` 登录按钮 | 内联 try/catch 提取 hostname | `hostOf(src.bookSourceUrl)` |

验证：tsc 0 + vitest 570/570。

---

## 第 3 批 · ST-2 收尾 / 去重 / 常量化 / 调试日志

| 编号 | 位置 | 修复 |
|---|---|---|
| ST-2(收尾) | `sourceDebug.ts`、`sourceVerify.ts`（顺带消除一处 `as any`）、`ExplorePage.tsx`、`SourceBookPage.tsx`、`tempVerifyApi.test.ts` | 共 6 处内联 hostname 提取统一为 `bookSourceEngine` 的 `hostOf()`（含导入补齐） |
| ST-3 | 新建 `src/utils/format.ts` | `formatBytes` 去重：`SettingsPage.tsx` 与 `DeveloperLogDialog.tsx` 改为共享导入 |
| ST-7 | `src/services/api.ts` | 新增 `HTTP_TIMEOUT_HEALTH`(8000) / `HTTP_TIMEOUT_SEARCH`(10000) / `HTTP_TIMEOUT_IMPORT`(20000)；替换 5 文件 7 处魔法数字；`ReaderPage` `pageGuard < 20` → `MAX_CONTENT_PAGES` |
| ST-8 | `ReaderPage.tsx` | 删除 3 处把章节 HTML/正文 dump 到控制台的调试日志（隐私+日志量）；保留预加载失败错误日志；已 grep 确认无测试依赖 `[sourcereader]` 输出 |

**回归插曲**：新常量经 `vi.mock("./api")` 工厂时未导出导致 4 个测试文件 10 个用例失败；补 mock 常量（`bookSourceImport.test.ts` / `searchService.test.ts` / `sourceSubscription.test.ts`）并更新 `backup.test.ts` 的 `toEqual` 精确断言后全绿。

验证：tsc 0 + vitest 570/570。

---

## 第 4 批 · 剩余错误处理 / 命名 / 小项

| 编号 | 位置 | 修复 |
|---|---|---|
| EH-9 | `BookSourceManager.tsx` 订阅自动同步 | 静默失败 → 逐个 await 计数；失败时提示"N/M 个订阅自动同步失败（网络或地址失效），可稍后手动同步" + `console.warn` |
| EH-10 | `src-tauri/src/cookies.rs` `save()` | 锁中毒 / 文件创建失败 / 序列化写入失败三种情况均 `eprintln!` 记日志（排查"登录态丢失"） |
| ST-6 | `ruleParser.ts` / `jsEvaluator.ts` / `ruleExtractor.ts` | 引擎上下文 `cookieHost` → `cookieJar`（7 处），与 `httpGet` 参数名对齐，命名从三套收敛为两套 |
| ST-11 | `sourceVerify.ts` | `80`/`30` → `MIN_SEARCH_HTML_LENGTH` / `MIN_CONTENT_LENGTH` 命名常量 |
| CL-9 | `src-tauri/src/net.rs` `utf16_units` | `bytes[2..]` → `bytes.get(2..).unwrap_or(&[])` 防御性切片 |
| CL-10 | `src-tauri/src/tts.rs` `escape_powershell_string` | 补文档注释：明确仅覆盖单引号字符串字面量场景 |
| ST-5 | `src/services/api.ts` `httpGet` | JSDoc：推荐选项对象形式，位置参数形式标记仅兼容保留 |

验证：tsc 0 + vitest 570/570 + cargo 39/39 + clippy 0。

---

## 第 5 批 · CL-5 断言清零 + ST-4 大文件拆分

### CL-5 `ReaderPage.tsx` 非空断言 10 → 0
类型本为判别联合，10 处 `book!` 全部改为在 `isLocal` 已收窄分支直接访问 `source.book`（TS 别名条件收窄）；`handleRemoveBroken` 补 `if (!isLocal) return;` 守卫。效果：书源模式误访问本地书字段将从运行时隐患变为编译错误。

### ST-4a `ruleExtractor.ts` 1042 → ~896 行
- 新建 `src/services/bookSourceEngine/jsonPath.ts`（~150 行）：`jsonGet` + 分词/递归下降/通配/切片/过滤求值，纯函数零依赖
- 桶 `index.ts` 改从新模块导出；外部消费方（`sourceToc.ts`、测试）零改动

### ST-4b `LibraryPage.tsx` 1066 → ~930 行
- 新建 `src/pages/libraryShelf.ts`：`loadLayout`/`loadSort`/`sortShelfItems`(6 种模式)/`itemMember`/`memberKey`，及从 3 个 useMemo 抽出的 `filterByGroup`/`filterByText`/`collageOf`
- 新增 `src/pages/libraryShelf.test.ts` 12 个特征化测试（排序稳定性、手动排序忽略升降序、分组/文本过滤、拼贴、持久化回退）

### 外部改动接入（非本会话所改）
会话中途 `TtsBar.tsx` 被外部新增睡眠定时功能（定时停止朗读/倒计时/取消菜单），但引用了不存在的 `TimerIcon` 导致全项目编译失败。已代为补齐：
- `icons.tsx` 新增 `TimerIcon`（秒表 SVG，沿用现有风格）
- `ReaderPage.css` 补 `tts-sleep-*` 下拉菜单样式（原类名无任何 CSS）

验证：tsc 0 + vitest 582/587（+12 新测试）+ cargo 39/39 + clippy 0。

---

## 遗留项（有意不做 / 待后续）

| 项 | 原因 |
|---|---|
| CL-12 `aes.ts` 非空断言（40+ 处）、CL-13 `== null`、CL-14 `search.rs` expect | Nit 级；触碰加密代码风险大于收益 |
| PF / TC / OE 三个审查智能体报告 | 审查期间被中断未提交（因并发编辑风险）；CL/EH/ST 三维已全量处理 |
| `TtsBar.tsx` 睡眠定时 | 功能已接入可编译；为外部未完成工作，后续完善请单独说明 |

## 统计
- 修复发现总数：**~65 项**（Critical 5 / Major ~14 / Minor+Nit 其余）
- 文件变更：Rust 11 个、前端服务 14 个、页面/组件 9 个、测试 15 个；新增 6 个文件（`format.ts`、`jsonPath.ts`、`libraryShelf.ts`、`libraryShelf.test.ts`、rss 测试模块、本报告）
- 所有改动均未提交（git 工作区保留），提交可随时安排
