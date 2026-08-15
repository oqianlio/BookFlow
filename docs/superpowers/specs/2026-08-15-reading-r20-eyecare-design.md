# 阅读体验 R20（A2）：护眼定时

日期：2026-08-15
状态：已批准（用户确认 A2 范围）

## 1. 目标

设置页新增「护眼定时」：设定开始/结束时间段（跨午夜支持），应用自动在夜间窗口内切 dark 主题，窗口外恢复用户手动选择的模式。

## 2. 设计

- **`src/services/eyeCare.ts`**（新建）：`EyeCareSettings { enabled, start, end }`；`loadEyeCare/saveEyeCare`（settings 表持久化）；`isInNightWindow(now, start, end)`——常规/跨午夜/同时间。
- **`src/services/eyeCareWatcher.ts`**（新建）：`startEyeCareWatcher(intervalMs)`——启动检查 + 定时（60s）；窗口内非 dark → 切 dark；窗口外非 manualMode → 恢复。
- **`main.tsx`**：启动 watcher。
- **`SettingsPage.tsx`**：护眼定时分组（开关 segmented + time inputs）；`toggleMode` 记录 `reader.manualMode`（窗口外恢复依据）。
- 样式：`.time-range`。

## 3. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/eyeCare.ts` | 新建 |
| `src/services/eyeCare.test.ts` | 新建：时间窗口测试 |
| `src/services/eyeCareWatcher.ts` | 新建 |
| `src/main.tsx` | 启动 watcher |
| `src/pages/SettingsPage.tsx` | 护眼分组 + manualMode |
| `src/App.css` | time-range 样式 |
| `src/pages/SettingsPage.test.tsx` | 适配 + 用例 |

## 4. 验证

- eyeCare 4 用例（常规/跨午夜/同时间/日间窗口）。
- SettingsPage 护眼开关 + 时间输入显示。
- 全量 `npm test`、`npm run build`。
