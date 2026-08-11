# 子项目3：图片章节（漫画/听书）设计文档

日期：2026-08-10
状态：已批准

## 1. 背景与目标

部分 legado 书源（漫画、部分听书）的章节正文是图片（`<img>` 标签），而非文本。当前「枕书」的 `SourceReaderPage` 只渲染文本（`extractSingle` 默认取 `@text`/`textNodes`，图片标签在取文本时丢失）。为对齐 legado 3.0，本子项目支持图片章节：检测章节 HTML 中的 `<img>`，以漫画模式逐图渲染。

**参考**：legado-md3 `ContentRule.kt`（content/subContent/imageStyle/imageDecode）、`ContentHelp.kt`（章节解析）。legado 通过保留正文 HTML 并检测其中的图片链接来渲染漫画。

## 2. 非目标

- 不支持 `imageDecode`（图片 bytes 级 JS 解码）—— 复杂且少用。
- 不支持 `imageStyle`（尺寸/排版）—— 用默认纵向滚动。
- 不支持音频播放（听书的音频标签渲染）—— 本子项目仅图片；音频若后续需要单独处理。
- 不实现图片预加载/内存优化（横向翻页漫画的进阶体验）。

## 3. 技术架构

```
SourceReaderPage
  ├─ extractSingle(...) → 正文（文本或 HTML）
  ├─ 检测：isImageChapter(contentHtml) — 解析 HTML，统计 img 数量
  │    ├─ 图片章节 → MangaViewer（纵向滚动，逐 <img> 渲染）
  │    └─ 文本章节 → 现有文本渲染（净化后 dangerouslySetInnerHTML）
  └─ CSP img-src 放宽：允许 http/https 书源图片
```

### 3.1 图片检测

关键点：`extractSingle` 默认返回 `@text`（文本，丢标签）。图片章节需正文为 **HTML**（规则用 `@html` 或引擎保留 img）。

- 若 `extractSingle` 返回的字符串含 `<img`（说明规则是 `@html` 或 content 直接返回 HTML），解析并统计。
- 若返回纯文本（无 img）→ 文本章节，现状不变。
- `isImageChapter(html: string): boolean`：`/<\s*img\b/i` 检测，且 img 数量 ≥ 1。

```ts
export function isImageChapter(html: string): boolean {
  return /<\s*img\b/i.test(html);
}
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const doc = parseHtml(html);
  const urls: string[] = [];
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (src) urls.push(resolveUrl(src, baseUrl));
  });
  return urls;
}
```

### 3.2 漫画渲染

- 新增 `src/readers/MangaViewer.tsx`：props `{ images: string[]; onError?: (msg: string) => void }`。
- 纵向滚动列表，每张 `<img>` 懒加载（`loading="lazy"`），点击可看大图（进阶，先不做）。
- 复用现有 reader 主题（`md-reader` 容器样式或新增 `manga-viewer`）。
- 图片 URL 直接作为 `<img src>`（书源远程图），经 CSP 允许。

### 3.3 CSP 放宽

`src-tauri/tauri.conf.json` 的 `img-src`：
```
"img-src": "'self' asset: http://asset.localhost blob: data: https: http:",
```
（允许书源远程图片。`https:`/`http:` 是宽松通配，评估后采用；若需收紧，可仅允许 img。）

### 3.4 SourceReaderPage 接入

```tsx
// 先检测图片（用原始 text，避免净化干扰 img 检测）
if (isImageChapter(text)) {
  const images = extractImageUrls(text, c.url);
  setImages(images); setContent(""); // 漫画模式
} else {
  const content = purifyContent(text, (src as any).purify); // 文本净化
  setContent(content); setImages([]); // 文本模式
}
```
> 注：图片章节的正文必须来自 `@html`（或含 `<img` 的 content 规则），`@text`/`@textNodes` 会丢标签。`purifyContent` 的移除列表不含 `img`，故净化不误伤图片；漫画模式下仍可先净化再提取（若需保留替换规则），但检测需在净化前基于原始 text。

## 4. 文件改动

- `src/services/bookSourceEngine.ts`：`isImageChapter`、`extractImageUrls`（纯函数）。
- `src/readers/MangaViewer.tsx`（新建）：漫画渲染组件。
- `src/pages/SourceReaderPage.tsx`：图片检测分流 + 渲染 MangaViewer。
- `src-tauri/tauri.conf.json`：`img-src` 加 `https: http:`。
- `src/pages/ReaderPage.css` / `App.css`：漫画样式。
- 测试：`bookSourceEngine.test.ts`（isImageChapter/extractImageUrls）、`MangaViewer.test.tsx`、`SourceReaderPage.test.tsx`（分流）。

## 5. 测试

- `isImageChapter`：含 `<img>` 返回 true；纯文本返回 false。
- `extractImageUrls`：提取 src/data-src；相对 URL 基于 baseUrl 解析；无图返回空数组。
- `MangaViewer`：渲染图片列表、空态、onError。
- `SourceReaderPage`：图片章节渲染 MangaViewer、文本章节渲染文本（mock httpGet 分别返回含 img 与纯文本）。
- 现有测试保持绿：`npm test`（141 个）。

## 6. 交付文件

- `src/services/bookSourceEngine.ts`（isImageChapter/extractImageUrls）
- `src/readers/MangaViewer.tsx`（新建）
- `src/pages/SourceReaderPage.tsx`
- `src-tauri/tauri.conf.json`（img-src）
- `src/pages/ReaderPage.css`（漫画样式）
- 测试：bookSourceEngine.test.ts、MangaViewer.test.tsx、SourceReaderPage.test.tsx

## 7. 已知限制

- 仅图片章节（img 标签）；音频/视频标签不处理。
- `imageDecode`/`imageStyle` 不实现（spec §2）。
- 远程图片受目标站反盗链影响（需书源 header 或 referer，后续可加）。
- 图片 URL 若为相对路径，基于章节 URL 解析（extractImageUrls 已处理）。
