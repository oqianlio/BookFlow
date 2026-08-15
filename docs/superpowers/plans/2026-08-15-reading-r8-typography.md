# 阅读体验 R8：排版扩展（字距/段距/缩进/加粗/字体） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R3 阅读设置面板扩展字间距、段间距、首行缩进、加粗、字体选择；持久化 + 即时生效（PaginatedReader 重切）。

**Architecture:** readingSettings.ts 扩展字段 + FONT_PRESETS + resolveFontCss；PaginatedReader 加 typography prop（测量容器 + 渲染容器注入，变化重切）；ReaderPage 面板加控件。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖、无 Rust 改动。

## Global Constraints

- 仅书源正文（PaginatedReader 路径）；本地书排版本批不做。
- 不做自定义背景色、字体文件加载。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/readingSettings.ts` | 新字段 + FONT_PRESETS + resolveFontCss | 修改 |
| `src/services/readingSettings.test.ts` | 新字段测试 | 修改 |
| `src/readers/PaginatedReader.tsx` | typography prop + 注入 | 修改 |
| `src/readers/PaginatedReader.test.tsx` | typography 测试 | 修改 |
| `src/pages/ReaderPage.tsx` | 面板新控件 + 传 typography | 修改 |
| `src/pages/ReaderPage.css` | 段落间距变量 | 修改 |
| `src/pages/ReaderPage.source.test.tsx` | 新控件测试 | 修改 |

## 任务依赖

Task 1（readingSettings）→ Task 2（PaginatedReader）→ Task 3（ReaderPage 面板）→ Task 4（验证）。

---

### Task 1: readingSettings 扩展

**Files:**
- Modify: `src/services/readingSettings.ts`
- Test: `src/services/readingSettings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReadingSettings {
    pageMode: PageMode; fontSizePx: number; lineHeight: number; bgTheme: string;
    letterSpacingPx: number; paragraphSpacingPx: number; indentEm: number;
    bold: boolean; fontFamily: string;
  }
  export const FONT_PRESETS: Array<{ id: string; name: string; css: string }>;
  export function resolveFontCss(fontFamily: string): string;
  ```

- [ ] **Step 1: 追加失败测试（readingSettings.test.ts）**

```ts
it("includes typography defaults", async () => {
  vi.mocked(api.getSetting).mockResolvedValue(null);
  const s = await loadReadingSettings();
  expect(s.letterSpacingPx).toBe(0);
  expect(s.paragraphSpacingPx).toBe(11);
  expect(s.indentEm).toBe(0);
  expect(s.bold).toBe(false);
  expect(s.fontFamily).toBe("serif");
});

it("loads and sanitizes typography values", async () => {
  vi.mocked(api.getSetting).mockImplementation(async (k) => {
    if (k === "reading.letterSpacingPx") return "1.5";
    if (k === "reading.paragraphSpacingPx") return "16";
    if (k === "reading.indentEm") return "1";
    if (k === "reading.bold") return "1";
    if (k === "reading.fontFamily") return "sans";
    return null;
  });
  const s = await loadReadingSettings();
  expect(s.letterSpacingPx).toBe(1.5);
  expect(s.paragraphSpacingPx).toBe(16);
  expect(s.indentEm).toBe(1);
  expect(s.bold).toBe(true);
  expect(s.fontFamily).toBe("sans");
});

it("falls back to defaults for invalid typography values", async () => {
  vi.mocked(api.getSetting).mockImplementation(async (k) => {
    if (k === "reading.letterSpacingPx") return "99";
    if (k === "reading.paragraphSpacingPx") return "-5";
    if (k === "reading.indentEm") return "9";
    return null;
  });
  const s = await loadReadingSettings();
  expect(s.letterSpacingPx).toBe(0);
  expect(s.paragraphSpacingPx).toBe(11);
  expect(s.indentEm).toBe(0);
});

it("saveReadingSettings persists typography keys", async () => {
  await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, letterSpacingPx: 2, paragraphSpacingPx: 14, indentEm: 1.5, bold: true, fontFamily: "kai" });
  expect(api.setSetting).toHaveBeenCalledWith("reading.letterSpacingPx", "2");
  expect(api.setSetting).toHaveBeenCalledWith("reading.paragraphSpacingPx", "14");
  expect(api.setSetting).toHaveBeenCalledWith("reading.indentEm", "1.5");
  expect(api.setSetting).toHaveBeenCalledWith("reading.bold", "1");
  expect(api.setSetting).toHaveBeenCalledWith("reading.fontFamily", "kai");
});

it("resolveFontCss maps presets and passes through custom names", () => {
  expect(resolveFontCss("serif")).toContain("Georgia");
  expect(resolveFontCss("custom-font")).toBe("custom-font");
  expect(resolveFontCss("")).toBe('"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif');
});
```

（DEFAULT_READING_SETTINGS 需先扩展，测试文件 import 它。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/readingSettings.test.ts`
Expected: FAIL（类型缺字段）

- [ ] **Step 3: 实现**

```ts
export interface ReadingSettings {
  pageMode: PageMode;
  fontSizePx: number;
  lineHeight: number;
  bgTheme: string;
  letterSpacingPx: number;
  paragraphSpacingPx: number;
  indentEm: number;
  bold: boolean;
  fontFamily: string;
}

export const FONT_PRESETS: Array<{ id: string; name: string; css: string }> = [
  { id: "serif", name: "衬线", css: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif' },
  { id: "sans",  name: "黑体", css: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
  { id: "kai",   name: "楷体", css: '"Kaiti SC", KaiTi, "STKaiti", "Noto Serif SC", serif' },
  { id: "yuan",  name: "圆体", css: '"Yuanti SC", "YouYuan", "Microsoft YaHei", sans-serif' },
];

export function resolveFontCss(fontFamily: string): string {
  const hit = FONT_PRESETS.find((f) => f.id === fontFamily);
  if (hit) return hit.css;
  return fontFamily.trim() || FONT_PRESETS[0].css;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  pageMode: "scroll", fontSizePx: 18, lineHeight: 1.8, bgTheme: "paper",
  letterSpacingPx: 0, paragraphSpacingPx: 11, indentEm: 0, bold: false, fontFamily: "serif",
};
```

load 扩展（Promise.all 加 5 键；校验范围后并入返回值）：

```ts
const SPACE_MIN = 0, SPACE_MAX = 4, PARA_MIN = 0, PARA_MAX = 24, INDENT_MIN = 0, INDENT_MAX = 2;
const [mode, size, line, bg, ls, ps, ind, bld, fam] = await Promise.all([...]);
// ...
letterSpacingPx: numInRange(ls, SPACE_MIN, SPACE_MAX, DEFAULT.letterSpacingPx),
paragraphSpacingPx: numInRange(ps, PARA_MIN, PARA_MAX, DEFAULT.paragraphSpacingPx),
indentEm: numInRange(ind, INDENT_MIN, INDENT_MAX, DEFAULT.indentEm),
bold: bld === "1",
fontFamily: fam && fam.trim() ? fam : DEFAULT.fontFamily,
```

save 扩展（加 5 键）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/readingSettings.test.ts`
Expected: 全绿（含新增 5）

- [ ] **Step 5: Commit**

```bash
git add src/services/readingSettings.ts src/services/readingSettings.test.ts
git commit -m "feat: 阅读排版设置状态（字距/段距/缩进/加粗/字体）"
```

---

### Task 2: PaginatedReader typography prop

**Files:**
- Modify: `src/readers/PaginatedReader.tsx`
- Test: `src/readers/PaginatedReader.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface TypographyStyle {
    letterSpacingPx: number;
    paragraphSpacingPx: number;
    indentEm: number;
    bold: boolean;
    fontFamily: string;
  }
  // props 加 typography?: TypographyStyle
  ```

- [ ] **Step 1: 追加失败测试（PaginatedReader.test.tsx）**

```tsx
it("applies typography styles to the slice container", () => {
  const typography = { letterSpacingPx: 1.5, paragraphSpacingPx: 16, indentEm: 1, bold: true, fontFamily: "serif" };
  const { container } = render(<PaginatedReader html={CONTENT} mode="scroll" typography={typography} measure={mockMeasure} />);
  const slice = container.querySelector(".reader-page-slice") as HTMLElement;
  expect(slice.style.letterSpacing).toBe("1.5px");
  expect(slice.style.textIndent).toBe("1em");
  expect(slice.style.fontWeight).toBe("700");
  expect(slice.style.fontFamily).toBe("serif");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/readers/PaginatedReader.test.tsx`
Expected: FAIL（无 typography）

- [ ] **Step 3: 实现**

```tsx
export interface TypographyStyle {
  letterSpacingPx: number; paragraphSpacingPx: number; indentEm: number;
  bold: boolean; fontFamily: string;
}

const DEFAULT_TYPO: TypographyStyle = { letterSpacingPx: 0, paragraphSpacingPx: 11, indentEm: 0, bold: false, fontFamily: "serif" };

export default function PaginatedReader({ html, mode = "scroll", fontSizePx = 18, lineHeight = 1.8, typography, onPageChange, measure, onMenuToggle }: {
  html: string; mode?: PageMode; fontSizePx?: number; lineHeight?: number;
  typography?: TypographyStyle;
  onPageChange?: (cur: number, total: number) => void;
  measure?: (h: string) => number;
  onMenuToggle?: () => void;
}) {
  const ty = { ...DEFAULT_TYPO, ...typography };
  // realMeasure 依赖加 ty 字段
  const realMeasure = useCallback((h: string): number => {
    if (measureRef.current) return measureRef.current(h);
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;visibility:hidden;width:${wrap.clientWidth || 400}px;font-size:${fontSizePx}px;line-height:${lineHeight};letter-spacing:${ty.letterSpacingPx}px;text-indent:${ty.indentEm}em;font-weight:${ty.bold ? 700 : 400};font-family:${ty.fontFamily};white-space:normal;`;
    el.innerHTML = `<style>.m-p p{margin:0 0 ${ty.paragraphSpacingPx}px}</style><div class="m-p">${h}</div>`;
    wrap.appendChild(el);
    const height = el.getBoundingClientRect().height;
    wrap.removeChild(el);
    return height;
  }, [fontSizePx, lineHeight, ty.letterSpacingPx, ty.paragraphSpacingPx, ty.indentEm, ty.bold, ty.fontFamily]);
  // ...
  return (
    <div className="reader-slice-wrap" ref={wrapRef} onClick={handleClick} style={{ fontSize: fontSizePx }}>
      {pages.map((p, i) => (
        <div
          key={i}
          className={...}
          style={{
            display: i === page ? "block" : "none",
            lineHeight,
            letterSpacing: `${ty.letterSpacingPx}px`,
            textIndent: `${ty.indentEm}em`,
            fontWeight: ty.bold ? 700 : 400,
            fontFamily: ty.fontFamily,
            ["--para-gap" as any]: `${ty.paragraphSpacingPx}px`,
          }}
          dangerouslySetInnerHTML={{ __html: p }}
        />
      ))}
      ...
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/readers/PaginatedReader.test.tsx`
Expected: 全绿（含新增 1）

- [ ] **Step 5: Commit**

```bash
git add src/readers/PaginatedReader.tsx src/readers/PaginatedReader.test.tsx
git commit -m "feat: PaginatedReader 支持排版样式注入与重切"
```

---

### Task 3: ReaderPage 面板扩展

**Files:**
- Modify: `src/pages/ReaderPage.tsx`
- Modify: `src/pages/ReaderPage.css`
- Test: `src/pages/ReaderPage.source.test.tsx`

- [ ] **Step 1: import resolveFontCss/FONT_PRESETS**

```tsx
import { loadReadingSettings, saveReadingSettings, BG_THEMES, FONT_PRESETS, resolveFontCss, DEFAULT_READING_SETTINGS, type ReadingSettings } from "../services/readingSettings";
```

- [ ] **Step 2: 面板新控件（行距组后、背景组前）**

```tsx
<div className="settings-group">
  <label className="settings-label">字间距 {settings.letterSpacingPx.toFixed(1)}px</label>
  <div className="range-row">
    <input type="range" min={0} max={4} step={0.1} value={settings.letterSpacingPx} aria-label="字间距"
      onChange={(e) => updateSetting({ letterSpacingPx: Number(e.target.value) })} />
    <span className="range-value">{settings.letterSpacingPx.toFixed(1)}</span>
  </div>
</div>
<div className="settings-group">
  <label className="settings-label">段间距 {settings.paragraphSpacingPx}px</label>
  <div className="range-row">
    <input type="range" min={0} max={24} step={1} value={settings.paragraphSpacingPx} aria-label="段间距"
      onChange={(e) => updateSetting({ paragraphSpacingPx: Number(e.target.value) })} />
    <span className="range-value">{settings.paragraphSpacingPx}</span>
  </div>
</div>
<div className="settings-group">
  <label className="settings-label">首行缩进 {settings.indentEm.toFixed(1)}em</label>
  <div className="range-row">
    <input type="range" min={0} max={2} step={0.1} value={settings.indentEm} aria-label="首行缩进"
      onChange={(e) => updateSetting({ indentEm: Number(e.target.value) })} />
    <span className="range-value">{settings.indentEm.toFixed(1)}</span>
  </div>
</div>
<div className="settings-group">
  <label className="settings-label">加粗</label>
  <div className="segmented" role="group" aria-label="加粗">
    <button type="button" className={!settings.bold ? "active" : ""} onClick={() => updateSetting({ bold: false })}>正常</button>
    <button type="button" className={settings.bold ? "active" : ""} onClick={() => updateSetting({ bold: true })}>加粗</button>
  </div>
</div>
<div className="settings-group">
  <label className="settings-label">字体</label>
  <div className="segmented" role="group" aria-label="字体">
    {FONT_PRESETS.map((f) => (
      <button key={f.id} type="button" className={settings.fontFamily === f.id ? "active" : ""} onClick={() => updateSetting({ fontFamily: f.id })}>{f.name}</button>
    ))}
  </div>
  <input className="font-custom-input" placeholder="自定义字体名（CSS font-family）" value={FONT_PRESETS.some((f) => f.id === settings.fontFamily) ? "" : settings.fontFamily}
    onChange={(e) => updateSetting({ fontFamily: e.target.value || "serif" })} aria-label="自定义字体" />
</div>
```

- [ ] **Step 3: 传 typography 给 PaginatedReader**

```tsx
<PaginatedReader
  html={...}
  mode={settings.pageMode}
  fontSizePx={settings.fontSizePx}
  lineHeight={settings.lineHeight}
  typography={{
    letterSpacingPx: settings.letterSpacingPx,
    paragraphSpacingPx: settings.paragraphSpacingPx,
    indentEm: settings.indentEm,
    bold: settings.bold,
    fontFamily: resolveFontCss(settings.fontFamily),
  }}
  onMenuToggle={...}
/>
```

- [ ] **Step 4: 样式（ReaderPage.css）**

```css
.reader-page-slice p { margin: 0 0 var(--para-gap, 11px); }
.reader-page-slice > *:last-child { margin-bottom: 0; }
.font-custom-input {
  width: 100%; margin-top: 8px; padding: 7px 10px; box-sizing: border-box;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--fg); font-size: 12.5px;
}
```

（把现有 `.reader-page-slice > * { margin: 0 0 1.1em }` 调整为 p 用变量。）

- [ ] **Step 5: 测试（ReaderPage.source.test.tsx 追加）**

```tsx
it("adjusts typography controls and passes them to PaginatedReader", async () => {
  const { container } = await renderWithSettings();
  await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
  fireEvent.change(screen.getByLabelText("字间距"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("段间距"), { target: { value: "16" } });
  fireEvent.change(screen.getByLabelText("首行缩进"), { target: { value: "1" } });
  await userEvent.click(screen.getByRole("button", { name: "加粗" }));
  await userEvent.click(screen.getByRole("button", { name: "楷体" }));
  const slice = container.querySelector(".reader-page-slice") as HTMLElement;
  await waitFor(() => {
    expect(slice.style.letterSpacing).toBe("2px");
    expect(slice.style.fontWeight).toBe("700");
  });
  expect(slice.style.fontFamily).toContain("KaiTi");
  await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.bold", "1"));
});
```

注意：`renderWithSettings` 是已有辅助（reading settings describe 内）。若作用域不同，复制或移到顶层。以实际运行为准。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run src/pages/ReaderPage.source.test.tsx`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src/pages/ReaderPage.tsx src/pages/ReaderPage.css src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 阅读设置面板排版扩展（字距/段距/缩进/加粗/字体）"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 readingSettings 5、PaginatedReader 1、ReaderPage 面板用例）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] readingSettings 新字段/预设/resolveFontCss + 5 测试 ✓
- [ ] PaginatedReader typography prop + 注入/重切 + 1 测试 ✓
- [ ] ReaderPage 面板新控件 + 传 typography ✓
- [ ] 本地书（EPUB/PDF/MD/TXT）未改动 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 排版扩展终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 排版扩展终审修复"
```

---
