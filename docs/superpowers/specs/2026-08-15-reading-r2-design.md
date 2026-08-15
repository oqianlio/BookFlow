# 复刻 legado 阅读体验 R2：切片翻页引擎

日期：2026-08-15
状态：已批准
前置：R1 统一阅读外壳完成；`<js>` 块 + java.ajax 完成。

## 1. 目标

在统一阅读页中，为**书源正文**与**本地 TXT/MD** 引入 legado 式**切片翻页引擎**：把章节内容按阅读区高度切分为独立"页"DOM 块，支持多翻页模式（本批：scroll/cover/slide），并用 `当前页/总页数` 显示进度。

## 2. 非目标

- EPUB/PDF 保持现有渲染（epub.js/pdf.js 自有翻页）。
- 仿真（simulation）与淡入（fade）翻页本批不做（模式常量预留）。
- 不做 R3 阅读设置面板（翻页模式切换器入口在 R3 放；R2 提供模式常量 + 组件内默认 scroll）。

## 3. 架构

```
新组件 src/readers/PaginatedReader.tsx（切片翻页引擎）
  props: { html: string; mode?: PageMode; fontSizePx?: number; onPageChange?: (cur, total) => void }
  PageMode = "scroll" | "cover" | "slide"（simulation/fade 预留）

  ├─ 切片：把 html 按阅读区高度切为 pages[]（每页独立 DOM）
  ├─ 渲染：当前页显示，其余隐藏（模式决定过渡）
  ├─ 翻页：区域点击（左上一页/中呼出菜单/右下一页）、方向键、滚动（scroll 模式）
  └─ 进度：onPageChange(cur, total)

统一 ReaderPage：
  - 书源正文（md-content 内联 HTML）→ <PaginatedReader html={...} />
  - 本地 txt → 文本转 html → <PaginatedReader />
  - 本地 md → marked html → <PaginatedReader />
```

### 3.1 切片算法（核心）

- **输入**：干净 HTML（书源正文已 purify；MD 经 marked；TXT 转段落 `<p>`）。
- **切片**（hidden 测量容器，等宽）：
  ```ts
  function sliceIntoPages(html: string, pageHeightPx: number): string[] {
    // 1. 把 html 的块级元素（p/div/li/hx）拆为可独立换行的片段数组
    // 2. 用二分查找：逐个加入片段到测量容器，当高度超过 pageHeight 时，
    //    回退到能放入的片段集，生成一页；剩余继续
    // 3. 尽量保留段落边界（不在段内截断，除非单段超一页则溢出）
  }
  ```
- **测量容器**：`position:absolute; visibility:hidden; width=阅读区宽; font-size=当前字号`。
- 重排：字号/窗口尺寸变化时重新切片（`useEffect` 依赖 html/fontSizePx/尺寸）。

### 3.2 渲染与翻页

- `pages.map` 渲染为 `.reader-page-slice`（绝对定位/横向排布），当前页 `display:block`，其他 `display:none`。
- 翻页控制：
  - `next()`/`prev()`：切页 + `onPageChange`。
  - scroll 模式：内容连续（一个长块滚动），翻页即滚动到块边界（近似）。
  - cover/slide：独立页切换，slide 加 CSS 过渡。
- 点击区域：`onClick` 判断 x 坐标（左 1/3 prev，右 1/3 next，中 1/3 呼出菜单）。注意与 R1 的 menuVisible 切换协调（中区呼出菜单，左右翻页）。

### 3.3 进度持久化

- 书源：`persist` 保存 `percent = 当前页/总页数`，恢复时跳到保存页。
- 本地 TXT/MD：沿用现有 `useReaderProgress`（location/percent），改为页号。

### 3.4 样式（ReaderPage.css）

```css
.reader-slice-wrap { position: relative; height: 100%; overflow: hidden; }
.reader-page-slice { position: absolute; inset: 0; overflow: hidden; padding: 0 4px; }
.reader-page-slice > * { margin: 0; }
```

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/readers/PaginatedReader.tsx` | 新建切片翻页引擎 |
| `src/readers/PaginatedReader.test.tsx` | 切片算法/翻页测试 |
| `src/pages/ReaderPage.tsx` | 书源正文 + TXT/MD 接入 |
| `src/readers/TxtReader.tsx` / `MdReader.tsx` | 改为输出 html 供 PaginatedReader（或 ReaderPage 接管） |
| `src/pages/ReaderPage.css` | 切片样式 |

## 5. 测试

- 切片：短文本 1 页、长文本多页、段落边界保留、超页段落处理。
- 翻页：next/prev、首/末页边界、onPageChange 回调。
- 模式：scroll/cover/slide 渲染差异。
- ReaderPage：书源正文渲染 PaginatedReader；现有测试保持绿。

## 6. 错误处理

- html 空 → 显示空态。
- 切片失败 → 回退整篇滚动渲染。
- 重排（字号/尺寸变化）自动重切。
