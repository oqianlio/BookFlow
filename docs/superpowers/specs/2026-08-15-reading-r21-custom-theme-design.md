# 阅读体验 R21（A4）：自定义主题

日期：2026-08-15
状态：待批准
前置：R3 背景主题（BG_THEMES 预设）完成。

## 1. 目标

阅读设置支持自定义背景/文字颜色：设置页（或阅读设置面板）提供颜色选择，保存为自定义主题，应用到阅读区（替代固定 4 预设）。对齐 legado 的主题自定义能力。

## 2. 设计

### 2.1 ReadingSettings 扩展

```ts
// 新增
customBg: string;   // 自定义背景色（#rrggbb），默认 ""（未设置）
customFg: string;   // 自定义文字色，默认 ""

// bgTheme 增加 "custom" 值：BG_THEMES 无此 id，load 时校验需放行 "custom"
```

- 存储键：`reading.customBg` / `reading.customFg`。
- `bgTheme === "custom"` 时：activeTheme 取 `{ bg: customBg, fg: customFg }`。

### 2.2 activeTheme 解析（ReaderPage）

```ts
function resolveActiveTheme(settings): { bg: string; fg: string } {
  if (settings.bgTheme === "custom" && settings.customBg) {
    return { bg: settings.customBg, fg: settings.customFg || "#1c1b1b" };
  }
  return BG_THEMES.find((t) => t.id === settings.bgTheme) ?? BG_THEMES[0];
}
```

### 2.3 设置页「自定义主题」分组

- 两个颜色输入：`input[type=color]` 背景色 + 文字色。
- 一个「应用自定义」按钮：`updateSetting({ bgTheme: "custom", customBg, customFg })`。
- 展示当前值（色块）。

放哪：**设置页（SettingsPage）**新增分组（全局自定义主题）；阅读设置面板保持预设快速切换（BG_THEMES），面板背景组加一个「自定义…」按钮跳设置页？**简化**：面板背景组加第 5 个色块「自定义」（点它应用 customBg/customFg），自定义色在设置页配置。

### 2.4 兼容

- `loadReadingSettings` 校验 bgTheme：`BG_THEMES.some(...) || bg === "custom"`。
- 未配置自定义（customBg 空）而 bgTheme=custom → 回退 paper。

## 3. 非目标

- 不做主题命名/多主题保存（单自定义主题）。
- 不做本地书 EPUB/PDF 自定义（A3 已覆盖 MD/TXT）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/readingSettings.ts` | customBg/customFg 字段 + bgTheme 放行 custom |
| `src/services/readingSettings.test.ts` | 新字段测试 |
| `src/pages/ReaderPage.tsx` | resolveActiveTheme 支持 custom |
| `src/pages/SettingsPage.tsx` | 自定义主题分组（color inputs） |
| `src/pages/SettingsPage.test.tsx` | 用例 |
| `src/pages/ReaderPage.source.test.tsx` | custom 应用测试 |

## 5. 测试

- readingSettings：customBg/customFg 默认空、load/save、bgTheme=custom 放行。
- ReaderPage：bgTheme=custom + customBg → main 背景为该色。
- SettingsPage：颜色输入存在、保存调用。
- 现有测试保持绿：`npm test`、`npm run build`。

## 6. 错误处理

- customBg 空且 bgTheme=custom → 回退 paper。
- 颜色格式非法 → 忽略（input[type=color] 保证合法）。
