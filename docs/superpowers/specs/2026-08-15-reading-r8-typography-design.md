# 复刻 legado 阅读体验 R8：排版扩展（字距/段距/缩进/加粗/字体）

日期：2026-08-15
状态：待批准
前置：R3 阅读设置面板完成。

## 1. 目标

在 R3 阅读设置面板基础上新增：字间距、段间距、首行缩进、字体加粗、字体选择。全部持久化（settings 表）并即时生效（PaginatedReader 重切）。

## 2. 背景与问题

R3 已有翻页模式/字号/行距/背景主题。legado 的排版能力远不止这些：字间距、段间距、首行缩进、加粗、字体家族都是阅读体验的核心调节项。当前 PaginatedReader 只接受 fontSizePx/lineHeight。

## 3. 非目标

- 不做自定义颜色选择器（背景色仍用预设 BG_THEMES）。
- 不做本地书（EPUB/PDF）排版设置（本批仍聚焦书源正文 + PaginatedReader 路径）。
- 不做字体文件加载/嵌入（用系统字体家族预设 + 自定义字体名输入）。
- 不做护眼定时、TTS 设置。

## 4. 架构

```
ReadingSettings 扩展（src/services/readingSettings.ts）
  + letterSpacingPx: number   // 字间距 0-4px，默认 0
  + paragraphSpacingPx: number // 段间距 0-24px，默认 11
  + indentEm: number          // 首行缩进 0-2em，默认 0
  + bold: boolean             // 加粗，默认 false
  + fontFamily: string        // 字体 id（预设）或自定义名，默认 "serif"

PaginatedReader 扩展（src/readers/PaginatedReader.tsx）
  + typography?: TypographyStyle prop
  - 测量容器 cssText 追加排版属性（字距/段距/缩进/加粗/字体 → 影响高度 → 重切）
  - 切片容器内联样式应用排版属性

ReaderPage 设置面板（src/pages/ReaderPage.tsx）
  + 字间距 slider、段间距 slider、缩进 slider、加粗 toggle、字体选择 segmented + 自定义输入
```

### 4.1 readingSettings.ts 扩展

```ts
export interface ReadingSettings {
  pageMode: PageMode;
  fontSizePx: number;
  lineHeight: number;
  bgTheme: string;
  letterSpacingPx: number;    // 0-4
  paragraphSpacingPx: number; // 0-24，默认 11
  indentEm: number;           // 0-2，默认 0
  bold: boolean;              // 默认 false
  fontFamily: string;         // 预设 id 或自定义，默认 "serif"
}

export const FONT_PRESETS: Array<{ id: string; name: string; css: string }> = [
  { id: "serif",   name: "衬线",  css: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif' },
  { id: "sans",    name: "黑体",  css: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
  { id: "kai",     name: "楷体",  css: '"Kaiti SC", KaiTi, "STKaiti", "Noto Serif SC", serif' },
  { id: "yuan",    name: "圆体",  css: '"Yuanti SC", "YouYuan", "Microsoft YaHei", sans-serif' },
];
```

- 存储键：`reading.letterSpacingPx` / `reading.paragraphSpacingPx` / `reading.indentEm` / `reading.bold` / `reading.fontFamily`。
- `bold` 存 "1"/"0"。
- 自定义字体：`fontFamily` 存自定义名字符串（不在 FONT_PRESETS 中即视为 CSS font-family 字面值）。

### 4.2 PaginatedReader typography prop

```ts
export interface TypographyStyle {
  letterSpacingPx: number;
  paragraphSpacingPx: number;
  indentEm: number;
  bold: boolean;
  fontFamily: string;   // CSS font-family 字符串（由调用方解析 FONT_PRESETS 或自定义）
}
```

- `typography?: TypographyStyle`，默认全默认值（与现有一致）。
- 测量容器 cssText 追加：

```
letter-spacing:${letterSpacingPx}px;text-indent:${indentEm}em;font-weight:${bold ? 700 : 400};
```

段落间距影响高度：注入 CSS 规则到测量容器——测量容器内 `.reader-measure-p p { margin: 0 0 ${paragraphSpacingPx}px }`？**更简单**：测量前给 html 段落追加内联 margin（切片 HTML 的 p 加 style），但 sliceHtmlIntoPages 是纯函数不应改 HTML 结构。**方案**：measure 容器里用 `<style>` 块注入段落 margin 规则，再放 html 内容——getBoundingClientRect 会计算样式表。可行（浏览器中 style 标签生效）。

```ts
el.innerHTML = `<style>.m-p p { margin: 0 0 ${paragraphSpacingPx}px }</style><div class="m-p">${h}</div>`;
```

- 切片渲染容器同样注入：`.reader-page-slice` 内联 style 加 `letterSpacing/indent/ fontWeight/fontFamily`，段落间距用 CSS 类（ReaderPage.css 定义 `.reader-page-slice p { margin: 0 0 var(--para-gap) }`，组件通过 style 变量传值）：

```tsx
<div className="reader-page-slice ..." style={{ display, lineHeight, letterSpacing: `${letterSpacingPx}px`, textIndent: `${indentEm}em`, fontWeight: bold ? 700 : 400, fontFamily, ["--para-gap" as any]: `${paragraphSpacingPx}px` }} />
```

- `realMeasure` 依赖加 typography 各字段（变化 → 重切）。

### 4.3 ReaderPage 设置面板扩展

- 字号行距区后追加：
  - 字间距：`.range-row` slider 0-4 step 0.1
  - 段间距：`.range-row` slider 0-24 step 1
  - 缩进：`.range-row` slider 0-2 step 0.1
  - 加粗：`.segmented` 正常/加粗（或 checkbox，用 segmented 一致）
  - 字体：FONT_PRESETS segmented + 「自定义」输入框（text input，输入即存）
- `updateSetting` 不变（patch 模式，防抖持久化）。
- 传 PaginatedReader：`typography={{ letterSpacingPx, paragraphSpacingPx, indentEm, bold, fontFamily: resolveFontCss(fontFamily) }}`。

`resolveFontCss`（readingSettings.ts 导出）：FONT_PRESETS 命中返回 css，否则返回 fontFamily 字面值。

### 4.4 样式（ReaderPage.css）

```css
.reader-page-slice p { margin: 0 0 var(--para-gap, 11px); }
.reader-page-slice > *:last-child { margin-bottom: 0; }
```

（现有 `.reader-page-slice > * { margin: 0 0 1.1em }` 改为 p 用 var(--para-gap) 控制，其他块级保留。）

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/readingSettings.ts` | 字段/预设/resolveFontCss + load/save 扩展 |
| `src/services/readingSettings.test.ts` | 新字段默认/roundtrip/非法回退 |
| `src/readers/PaginatedReader.tsx` | typography prop + 测量/渲染注入 |
| `src/readers/PaginatedReader.test.tsx` | typography 应用/重切测试 |
| `src/pages/ReaderPage.tsx` | 面板新控件 + 传 typography |
| `src/pages/ReaderPage.css` | 段落间距/排版变量 |
| `src/pages/ReaderPage.source.test.tsx` | 面板新控件测试 |

## 6. 测试

- readingSettings：新字段默认值、save/load roundtrip、非法值回退、resolveFontCss（预设命中/自定义）。
- PaginatedReader：typography 注入到切片容器（letterSpacing/textIndent/fontWeight/fontFamily/段距变量）、变化触发重切。
- ReaderPage：新控件改动 → PaginatedReader 收到新 typography、持久化调用。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 自定义字体名非法（空串）→ 回退 serif。
- settings 读取失败 → 默认值（现有 catch 覆盖）。
- 排版变化重切失败 → 回退当前页（现有机制）。
