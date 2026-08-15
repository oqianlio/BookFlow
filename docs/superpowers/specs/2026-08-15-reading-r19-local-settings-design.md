# 阅读体验 R19（A3）：本地书接入阅读设置

日期：2026-08-15
状态：待批准
前置：R8 排版扩展完成。

## 1. 目标

本地书（MD/TXT 滚动型阅读器）接入现有 ReadingSettings：字号、行距、字体（含自定义字体）、背景主题、简繁转换统一生效。EPUB/PDF 本批保留自身渲染（PDF 版式固定、EPUB 有独立排版引擎）。

## 2. 设计

### 2.1 方案：CSS 变量注入 + 本地书 CSS 改用变量

ReaderPage 的 `.reader-main` 注入 CSS 变量（本地书 + 书源统一）：

```tsx
<main
  className="reader-main"
  data-bg-theme={settings.bgTheme}
  style={{
    background: activeTheme.bg,
    ["--read-font-size" as any]: `${settings.fontSizePx}px`,
    ["--read-line-height" as any]: settings.lineHeight,
    ["--read-font-family" as any]: resolveFontCss(settings.fontFamily),
    ["--read-letter-spacing" as any]: `${settings.letterSpacingPx}px`,
    ["--read-para-gap" as any]: `${settings.paragraphSpacingPx}px`,
    ["--read-indent" as any]: `${settings.indentEm}em`,
    ["--read-bold" as any]: settings.bold ? 700 : 400,
    ["--read-fg" as any]: activeTheme.fg,
  }}
>
```

ReaderPage.css 的 `.md-content`/`.txt-page` 改用变量（替代写死的 17px/1.95）：

```css
.md-content {
  font-size: var(--read-font-size, 17px);
  line-height: var(--read-line-height, 1.95);
  font-family: var(--read-font-family, var(--font-read));
  letter-spacing: var(--read-letter-spacing, 0);
  font-weight: var(--read-bold, 400);
}
.md-content p { text-indent: var(--read-indent, 0); margin: 0 0 var(--read-para-gap, 1.1em); }
.txt-page { /* 同上 */ }
```

- 本地书（isLocal）也用 `settings`（不再 isLocal 时忽略背景/字号）。
- 背景：本地书 MD/TXT 用 `activeTheme.bg/fg`（现 `--bg`/`--fg` 固定浅色）。
- 简繁转换：本地书内容加载后 `convertText`？**本地书数据在 Reader.tsx 内读文件**——ReaderPage 无法介入。**本批本地书简繁不做**（书源已支持）；A3 聚焦字号/行距/字体/背景。

### 2.2 EPUB/PDF

- PDF：版式固定，不应用（保留白底 canvas）。
- EPUB：epubjs 自带 settings（字号等），本批不动；背景主题可后续。

## 3. 非目标

- 不做本地书简繁转换（数据在子组件内）。
- 不做 EPUB 字号接入（独立引擎，后续）。
- 不做 PDF 主题（版式固定）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/pages/ReaderPage.tsx` | `.reader-main` 注入 CSS 变量（本地+书源统一） |
| `src/pages/ReaderPage.css` | md-content/txt-page 改用变量 |
| `src/pages/ReaderPage.test.tsx` | 本地书设置应用测试 |
| `src/pages/ReaderPage.css` 现有 md/txt 测试 | 适配 |

## 5. 测试

- ReaderPage：本地书（md）渲染时 .reader-main 有 CSS 变量（字号/行距/字体），背景=activeTheme.bg。
- 书源路径回归（变量注入不影响 PaginatedReader）。
- 现有测试保持绿：`npm test`、`npm run build`。

## 6. 错误处理

- 变量缺省（未注入）→ CSS 回退原值（var() 兜底）。
