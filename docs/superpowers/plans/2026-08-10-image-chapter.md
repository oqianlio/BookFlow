# 子项目3：图片章节（漫画/听书）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 legado 书源的图片章节（漫画）：检测章节 HTML 中的 `<img>`，以漫画模式逐图渲染；CSP 放行书源远程图片。

**Architecture:** 新增 `isImageChapter`/`extractImageUrls` 纯函数检测图片章节；新增 `MangaViewer` 纵向滚动逐图渲染组件；`SourceReaderPage` 按图片/文本分流；`img-src` CSP 加 `https: http:`。

**Tech Stack:** React + TS + Vitest, Tauri 2 (CSP config)

**Spec:** `docs/superpowers/specs/2026-08-10-image-chapter-design.md`

## Global Constraints

- `isImageChapter(html)`：含 `<img` 返回 true。
- `extractImageUrls(html, baseUrl)`：提取 `src`/`data-src`，相对路径基于 baseUrl 解析，返回绝对 URL 数组。
- 图片章节正文来自 `@html` 规则（`@text`/`@textNodes` 丢标签）；检测基于净化前的原始 text。
- `MangaViewer` props `{ images: string[]; onError?: (msg: string) => void }`，纵向滚动、懒加载。
- CSP `img-src` 加 `https: http:`。
- UI 文案使用中文（无图/加载失败 etc.）。
- 现有测试保持绿：`npm test`（141 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: 图片检测纯函数 + CSP

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces:
  - `export function isImageChapter(html: string): boolean`
  - `export function extractImageUrls(html: string, baseUrl: string): string[]`

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
import { isImageChapter, extractImageUrls } from "./bookSourceEngine";

describe("image chapter detection", () => {
  it("detects img tags", () => {
    expect(isImageChapter(`<div class="content"><img src="/c/1.jpg"><img src="/c/2.jpg"></div>`)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isImageChapter("这是一段正文文本")).toBe(false);
  });

  it("extracts img src and data-src with baseUrl resolution", () => {
    const html = `<div><img src="/c/1.jpg"><img data-src="https://cdn.com/2.jpg"></div>`;
    const urls = extractImageUrls(html, "https://ex.com/book/1.html");
    expect(urls).toEqual(["https://ex.com/c/1.jpg", "https://cdn.com/2.jpg"]);
  });

  it("returns empty array when no images", () => {
    expect(extractImageUrls("<p>文本</p>", "https://ex.com")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: `isImageChapter`/`extractImageUrls` 不存在 FAIL。

- [ ] **Step 3: 实现**

`bookSourceEngine.ts` 追加：
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

`tauri.conf.json` 的 `img-src`：
```json
"img-src": "'self' asset: http://asset.localhost blob: data: https: http:",
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: 4 个新测试 + 现有全过。`cargo check` 验证 tauri.conf.json 合法。`npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts src-tauri/tauri.conf.json
git commit -m "feat: 图片章节检测与 CSP 放行"
```

---

### Task 2: MangaViewer 组件

**Files:**
- Create: `src/readers/MangaViewer.tsx`
- Create: `src/readers/MangaViewer.test.tsx`
- Modify: `src/pages/ReaderPage.css`

**Interfaces:**
- Consumes: 无（props 传入图片 URL 数组）
- Produces:
  - `export default function MangaViewer({ images, onError }: { images: string[]; onError?: (msg: string) => void })`

- [ ] **Step 1: 写失败的测试**

`src/readers/MangaViewer.test.tsx`：
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MangaViewer from "./MangaViewer";

describe("MangaViewer", () => {
  it("renders all images", () => {
    const { container } = render(<MangaViewer images={["https://ex.com/1.jpg", "https://ex.com/2.jpg"]} />);
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("https://ex.com/1.jpg");
  });

  it("shows empty state when no images", () => {
    render(<MangaViewer images={[]} />);
    expect(screen.getByText(/无图片/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/readers/MangaViewer.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现 MangaViewer.tsx**

```tsx
export default function MangaViewer({ images, onError }: { images: string[]; onError?: (msg: string) => void }) {
  if (images.length === 0) return <p className="panel-empty">无图片</p>;
  return (
    <div className="manga-viewer">
      {images.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          loading="lazy"
          alt={`图片 ${i + 1}`}
          onError={() => onError?.(`图片加载失败: ${src}`)}
        />
      ))}
    </div>
  );
}
```

`src/pages/ReaderPage.css` 追加：
```css
.manga-viewer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; overflow-y: auto; }
.manga-viewer img { max-width: 100%; height: auto; border-radius: 4px; background: #000; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/readers/MangaViewer.test.tsx`
Expected: 2 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/readers/MangaViewer.tsx src/readers/MangaViewer.test.tsx src/pages/ReaderPage.css
git commit -m "feat: MangaViewer 漫画渲染组件"
```

---

### Task 3: SourceReaderPage 图片分流

**Files:**
- Modify: `src/pages/SourceReaderPage.tsx`
- Modify: `src/pages/SourceReaderPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `isImageChapter`/`extractImageUrls`；Task 2 `MangaViewer`
- Produces: `SourceReaderPage` 增加 `images` state；`loadChapter` 按图片/文本分流；渲染 MangaViewer 或文本。

- [ ] **Step 1: 写失败的测试**

`src/pages/SourceReaderPage.test.tsx` 追加（先读现有测试的 mock 结构）：
```tsx
it("renders manga viewer for image chapters", async () => {
  vi.mocked(api.httpGet).mockResolvedValue(
    `<html><body><div class="content"><img src="/img/1.jpg"><img src="/img/2.jpg"></div></body></html>`,
  );
  // 书源 ruleContent.content 用 "@html" 类规则，或 mock httpGet 返回含 img 的 HTML
  render(<SourceReaderPage sourceId={1} bookUrl="https://ex.com/b/1.html" bookTitle="漫画"
    initialChapterIndex={0} initialChapterUrl="https://ex.com/c/1.html" initialChapterName="第1话" onBack={() => {}} />);
  const imgs = await screen.findAllByRole("img");
  expect(imgs.length).toBe(2);
});
```
> 注：需调整 mock 的 `ruleContent.content` 为 `@html`（如 `"@css:.content@html"`），否则 extractSingle 默认 text 会丢 img。阅读现有测试的 sourceJson 后调整。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/SourceReaderPage.test.tsx`
Expected: 新测试 FAIL（当前渲染文本，无 img）。

- [ ] **Step 3: 实现**

`SourceReaderPage.tsx`：
- 增加 `const [images, setImages] = useState<string[]>([]);`
- `loadChapter` 内，在提取 `text` 后：
```tsx
setContent(""); setImages([]);
if (isImageChapter(text)) {
  setImages(extractImageUrls(text, c.url));
} else {
  const purified = purifyContent(text, (src as any).purify);
  setContent(purified);
}
setLoading(false);
```
- 渲染（`main` 内，`!loading && !error` 分支）：
```tsx
{images.length > 0 ? (
  <MangaViewer images={images} onError={setError} />
) : chapter.url ? (
  <div className="md-reader"><div className="md-content" dangerouslySetInnerHTML={{ __html: `<p>${content.replace(/\n/g, "</p><p>")}</p>` }} /></div>
) : (
  <p className="panel-empty">请从目录选择章节</p>
)}
```
- import `isImageChapter`/`extractImageUrls`/`MangaViewer`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/pages/SourceReaderPage.test.tsx` — 新测试 + 现有全过。`npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/pages/SourceReaderPage.tsx src/pages/SourceReaderPage.test.tsx
git commit -m "feat: 阅读页图片章节分流"
```

---

## 已知限制（记录于 spec 附录）

- 仅图片章节（img 标签）；音频/视频不处理。
- `imageDecode`/`imageStyle` 不实现。
- 远程图片受目标站反盗链影响（referer/header 后续可加）。
