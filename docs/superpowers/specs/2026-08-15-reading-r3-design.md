# 复刻 legado 阅读体验 R3：阅读设置面板

日期：2026-08-15
状态：已批准
前置：R1 统一阅读外壳、R2 切片翻页完成。

## 1. 目标

统一阅读页顶栏「设置」入口弹出阅读设置面板，含翻页模式、字号/行距、背景色主题，全部持久化并即时生效（PaginatedReader 重切）。

## 2. 非目标

- 不做自定义颜色选择器（仅预设背景集）。
- 不做护眼定时、TTS 设置等扩展。
- 本地书（EPUB/PDF）阅读设置本批不做（聚焦书源正文 + PaginatedReader 路径）。

## 3. 架构

```
阅读设置状态（settings 表持久化）
  readingSettings = { pageMode, fontSizePx, lineHeight, bgTheme }
  key: "reading.pageMode" / "reading.fontSizePx" / "reading.lineHeight" / "reading.bgTheme"

ReaderPage：
  - 顶栏 toolbar-actions 加「设置」按钮 → setPanel("settings")
  - 面板：复用 panel 机制（annotations/bookmarks/settings）
  - 读取 settings → 传 PaginatedReader（pageMode/fontSizePx/lineHeight）
  - 背景主题应用到 .reader-main

PaginatedReader：
  - props 加 lineHeight?: number
  - fontSizePx/lineHeight 变化 → realMeasure 依赖变化 → 重切
  - pageMode 变化 → mode 切换
```

### 3.1 阅读设置状态（新文件 src/services/readingSettings.ts）

```ts
import { getSetting, setSetting } from "./api";

export type PageMode = "scroll" | "cover" | "slide";  // 复用 PaginatedReader 的
export interface ReadingSettings {
  pageMode: PageMode;
  fontSizePx: number;
  lineHeight: number;
  bgTheme: string;  // 主题 id
}

export const BG_THEMES: Array<{ id: string; name: string; bg: string; fg: string }> = [
  { id: "paper",   name: "纸白", bg: "#ffffff", fg: "#1c1b1b" },
  { id: "beige",   name: "纸黄", bg: "#f5e9d0", fg: "#2b2b2b" },
  { id: "green",   name: "护眼绿", bg: "#cde8cd", fg: "#1f1f1f" },
  { id: "night",   name: "夜间", bg: "#141313", fg: "#e5e2e1" },
];

export async function loadReadingSettings(): Promise<ReadingSettings>;
export async function saveReadingSettings(s: ReadingSettings): Promise<void>;
```

- 默认：`{ pageMode: "scroll", fontSizePx: 18, lineHeight: 1.8, bgTheme: "paper" }`。
- `loadReadingSettings` 逐键 getSetting（缺省用默认）。
- `saveReadingSettings` 逐键 setSetting。

### 3.2 设置面板（ReaderPage）

- toolbar-actions 加「设置」图标按钮，`onClick` → `setPanel("settings")`。
- `panel === "settings"` 渲染 `.reader-settings-panel`（复用 panel 样式）：
  - 翻页模式：`.segmented` 滚动/覆盖/滑动。
  - 字号：`.range-row` slider 14-24 → saveReadingSettings + 重切。
  - 行距：`.range-row` slider 1.4-2.4 step 0.1 → saveReadingSettings。
  - 背景：`BG_THEMES` 色块按钮，选中高亮。
- 改动即时生效：`settings` state 更新 → 传 PaginatedReader。

### 3.3 PaginatedReader 扩展

- props 加 `lineHeight?: number`（默认 1.8）。
- `.reader-page-slice` 的 line-height 由内联 style 或 prop 控制。
- `realMeasure` 依赖加 lineHeight（字号/行距变化都重切）。

### 3.4 背景主题应用

- `.reader-main` 背景 = 当前 bgTheme.bg；`.reader-page-slice` 前景 = fg。
- 通过内联 style 或 data-attr + CSS。

### 3.5 样式（ReaderPage.css）

```css
.reader-settings-panel { /* 复用 panel 样式 */ }
.reader-settings-panel .settings-group { margin-bottom: 12px; }
.bg-theme-options { display: flex; gap: 10px; }
.bg-theme-swatch { width: 32px; height: 32px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; }
.bg-theme-swatch.active { border-color: var(--accent); }
```

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/readingSettings.ts` | 新建：ReadingSettings/load/save/BG_THEMES |
| `src/pages/ReaderPage.tsx` | 设置按钮 + 面板 + 传 settings 给 PaginatedReader |
| `src/readers/PaginatedReader.tsx` | lineHeight prop + 重切依赖 |
| `src/pages/ReaderPage.css` | 面板/背景样式 |

## 5. 测试

- readingSettings：默认值、load/save roundtrip、缺失键回退默认。
- PaginatedReader：lineHeight prop 生效（传注入 measure）。
- ReaderPage：设置面板打开/切换翻页模式/改字号行距/选背景 → PaginatedReader 收到新 props。
- 现有测试保持绿。

## 6. 错误处理

- settings 读取失败 → 用默认值。
- 保存失败 → 提示（showError 或静默）。
- 重切失败 → 回退当前页。
