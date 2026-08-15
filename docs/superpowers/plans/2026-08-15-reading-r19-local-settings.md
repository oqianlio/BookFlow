# 阅读体验 R19（A3）：本地书接入阅读设置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MD/TXT 本地书应用现有阅读设置（字号/行距/字体/背景/排版）。

**Architecture:** ReaderPage `.reader-main` 注入 CSS 变量；ReaderPage.css 的 md/txt 样式改用变量；测试验证。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 本地书简繁不做（数据在子组件）；EPUB/PDF 保留自身渲染。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/pages/ReaderPage.tsx` | 注入 CSS 变量 | 修改 |
| `src/pages/ReaderPage.css` | md/txt 用变量 | 修改 |
| `src/pages/ReaderPage.test.tsx` | 本地书变量测试 | 修改 |

## 任务依赖

Task 1（变量注入）→ Task 2（CSS 改造）→ Task 3（测试）→ Task 4（验证）。

---

### Task 1: ReaderPage 注入 CSS 变量

**Files:**
- Modify: `src/pages/ReaderPage.tsx`

- [ ] **Step 1: .reader-main 统一注入**

当前（L441-445）isLocal 时无背景/变量。改为统一注入：

```tsx
<main
  className="reader-main"
  data-bg-theme={settings.bgTheme}
  style={{
    background: activeTheme.bg,
    color: activeTheme.fg,
    ["--read-font-size" as any]: `${settings.fontSizePx}px`,
    ["--read-line-height" as any]: settings.lineHeight,
    ["--read-font-family" as any]: resolveFontCss(settings.fontFamily),
    ["--read-letter-spacing" as any]: `${settings.letterSpacingPx}px`,
    ["--read-para-gap" as any]: `${settings.paragraphSpacingPx}px`,
    ["--read-indent" as any]: `${settings.indentEm}em`,
    ["--read-bold" as any]: settings.bold ? 700 : 400,
  }}
  onClick={isLocal || isManga || !chapter.url || loading || failed ? () => setMenuVisible((v) => !v) : undefined}
>
```

- 书源路径 PaginatedReader 已有独立 props（不变），但背景变量统一到 main 后，PaginatedReader 的 typography 仍显式传（无冲突）。
- 本地书 MD/TXT：`.md-reader`/`.txt-page` 在 main 内，继承变量。

- [ ] **Step 2: tsc 通过**

Run: `npx tsc --noEmit`

---

### Task 2: CSS 改造（md/txt 用变量）

**Files:**
- Modify: `src/pages/ReaderPage.css`

- [ ] **Step 1: .md-content**

```css
.md-content {
  max-width: 46em;
  margin: 0 auto;
  font-family: var(--read-font-family, var(--font-read));
  font-size: var(--read-font-size, 17px);
  line-height: var(--read-line-height, 1.95);
  color: var(--read-fg, var(--fg));
  letter-spacing: var(--read-letter-spacing, 0);
  font-weight: var(--read-bold, 400);
}
.md-content p {
  margin: 0 0 var(--read-para-gap, 1.1em);
  text-indent: var(--read-indent, 0);
}
```

- [ ] **Step 2: .txt-page**

```css
.txt-page {
  flex: 1;
  overflow-y: auto;
  padding: 40px 28px 60px;
  line-height: var(--read-line-height, 1.95);
  font-family: var(--read-font-family, var(--font-read));
  font-size: var(--read-font-size, 17px);
  color: var(--read-fg, var(--fg));
  letter-spacing: var(--read-letter-spacing, 0);
  font-weight: var(--read-bold, 400);
  max-width: 46em;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
.txt-page p { margin: 0 0 var(--read-para-gap, 0.9em); text-indent: var(--read-indent, 0); }
```

- [ ] **Step 3: 背景**

`.reader-main` 已有 `background: var(--bg)`（L97）。改为继承注入的 background（style 里已设 `background: activeTheme.bg`，CSS 会被内联覆盖）。确认 `.reader-main` 的 `background: var(--bg)` 不覆盖内联——内联优先级更高，OK。但 `.reader-page` 作用域的 `--bg` 变量仍在（书源背景选择器 `[data-bg-theme]` 已有）。本地书现在也设了 data-bg-theme → 背景选择器生效？现有 `.reader-main[data-bg-theme=...]` 只覆盖 `.reader-page-slice` 文字色。**加本地书文字色**：

```css
.reader-main[data-bg-theme] .md-content,
.reader-main[data-bg-theme] .txt-page { color: var(--read-fg, var(--fg)); }
```

（--read-fg 由 style 注入 activeTheme.fg，兜底 --fg。）

---

### Task 3: 测试

**Files:**
- Modify: `src/pages/ReaderPage.test.tsx`

- [ ] **Step 1: 新增用例**

```tsx
it("applies reading settings CSS variables to local book reader", async () => {
  render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
  const main = document.querySelector(".reader-main") as HTMLElement;
  // 等 settings 加载（默认值）后：
  await waitFor(() => {
    expect(main.style.getPropertyValue("--read-font-size")).toBe("18px");
    expect(main.style.getPropertyValue("--read-line-height")).toBe("1.8");
  });
  expect(main.style.background).toBeTruthy();  // activeTheme.bg
});
```

注意：ReaderPage.test.tsx 的 api mock 需含 getSetting（已有 `getSetting: vi.fn().mockResolvedValue(null)`）。本地书路径 settings 加载走 loadReadingSettings → getSetting(null) → 默认值。

- [ ] **Step 2: 适配**

- 现有本地书测试（Ctrl+B 等）不受影响（变量注入不改变行为）。
- 检查 md-reader 相关断言是否依赖具体字号（应无）。

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试** `npm test` 全绿
- [ ] **Step 2: 构建** `npm run build` 通过
- [ ] **Step 3: 终审清单**
  - [ ] .reader-main 统一注入 CSS 变量 ✓
  - [ ] md-content/txt-page 改用变量（含回退）✓
  - [ ] 背景/文字色本地书生效 ✓
  - [ ] 书源路径回归（PaginatedReader 不受影响）✓
  - [ ] 测试全绿、构建通过、工作树干净 ✓
- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 本地书阅读设置终审修复"
```
