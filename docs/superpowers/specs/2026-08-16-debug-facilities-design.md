# 开发调试设施设计（Developer Debug Facilities，2026-08-16）

## 背景

已有开发者日志（前端 console/error → app.log + 设置页面板），但仍有盲区：
Rust 后端事件不可见（只 println 终端，打包后丢失）、网络请求详情无持久化、
invoke 命令调用无跟踪、React 渲染崩溃无错误边界、无法一键导出诊断信息。

目标：让开发 agent 通过**读取文件/日志**就能定位大部分运行时问题，
不依赖用户在 GUI 里口头描述。

## 功能设计

### F1 Rust 统一日志（logger 模块）

- `src-tauri/src/logger.rs`：`log_info/log_warn/log_error(app_data_dir, msg)`
  追加写 `logs/app.log`，行格式 `[时间] [级别] [rust] 消息`
- 复用现有 `logs.rs` 的 append 机制（合并前缀标记）
- 替换散落的 `println/eprintln` 调试点（net.rs 的 [net] 等）

### F2 网络请求日志

- `http_get` 内记录：
  - 成功：`[net] GET https://x 200 1234ms 56KB`
  - 失败：`[net] GET https://x ERROR 超时(30s) host=xxx`
- 状态码从 `resp.status()` 获取；错误分类复用 `friendly_network_error`
- 记入 app.log（Rust 侧），同时保留终端输出

### F3 前端 invoke 跟踪

- `api.ts` 加 `tracked<T>(name, promise)` 包装：
  - 成功：`console.debug` 输出 `[invoke] name 12ms`
  - 失败：`console.error` 输出 `[invoke] name FAILED: err`
  - console 已被 main.tsx 劫持 → 自动持久化到 app.log
- 不改变各函数签名（内部包装 invoke 调用）

### F4 React ErrorBoundary

- `src/components/ErrorBoundary.tsx`：
  - `componentDidCatch` → `logFrontend("error", 组件栈 + 错误)` + showError
  - fallback UI：显示错误信息 + 重试按钮（清 error state 重渲染）
- 接入 App.tsx（包 AppInner），防止整棵组件树崩溃白屏

### F5 诊断导出

- Rust 命令 `export_diagnostics()`：收集
  - 应用版本（env!("CARGO_PKG_VERSION")）、数据目录、DB 大小
  - 书源数量（启用/总数）、缓存统计
  - 最近 200 行日志
  - 返回单个文本块
- 前端设置页「开发者日志」面板加「导出诊断」按钮 → 剪贴板复制
  （用户可贴给我，或我直接读 app.log）

## 实施顺序

1. F1 logger（Rust）+ 单元测试
2. F2 网络日志（net.rs 改）+ 测试
3. F3 invoke 跟踪（api.ts）
4. F4 ErrorBoundary + 测试
5. F5 诊断导出 + 设置页按钮 + 测试

每步独立提交、测试全绿、构建干净。
