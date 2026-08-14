# 复刻 legado 阅读体验 R1：统一阅读外壳

日期：2026-08-14
状态：已批准
前置：已完成 legado 书源引擎、MD3 界面、错误弹窗、布局优化。

## 1. 目标

建立统一的 legado 式阅读外壳，本地书与书源共用同一阅读页框架（工具栏/正文区/进度），保留现有渲染组件。为后续翻页引擎（R2）、阅读设置（R3）、阅读操作（R4）打基础。

## 2. 非目标

- 不重写翻页引擎（R2 做）。
- 不做阅读设置面板（R3 做）。
- 不做目录弹层重构（R4 做）。
- 本批仅合并外壳，渲染逻辑保留。

## 3. 架构

```
统一 ReaderPage（新，替代 ReaderPage + SourceReaderPage）
  ├─ 顶部工具栏：返回 | 书名/章节 | TTS | 设置入口（占位）
  ├─ 正文渲染区：按 source.kind 分发
  │    local  → Epub/Pdf/Md/TxtReader（现有）
  │    source → 书源正文/漫画（现有逻辑）
  ├─ 底部工具栏：上一章 | 进度 x% | 目录入口 | 下一章
  └─ 点击正文区呼出/隐藏工具栏（legado 式）
```

### 3.1 统一阅读源描述（ReaderSource 类型）

```ts
// src/services/reading.ts（新建）
export type ReaderSource =
  | { kind: "local"; book: Book }
  | { kind: "source"; sourceId: number; bookUrl: string; bookTitle: string;
      chapterIndex: number; chapterUrl: string; chapterName: string };
```

- `App.tsx` 的 `reader`/`sourceReader` 两个 detail 分支都渲染统一 `ReaderPage`，传不同 `source`。

### 3.2 统一 ReaderPage（src/pages/ReaderPage.tsx 重构）

- Props：`{ source: ReaderSource; onBack: () => void }`。
- **顶部工具栏**（复用 `.reader-toolbar`）：返回 + 标题（local=book.title；source=bookTitle[·章节]）+ 右侧：TTS（仅 local 有）或书源登录/章节（source）。
- **正文区**（`.reader-main`）：
  - local → 按 `book.format` 分发 4 个 reader（现有，含 error 处理/移除损坏书）。
  - source → 现有书源加载/正文/漫画/重试逻辑。
- **底部工具栏**（新 `.reader-bottom-bar`）：
  - local：显示 `上一章/下一章` 禁用（本地书无章节导航，但保留进度显示——reader 上报 percent）。
  - source：`上一章 | 进度 x% | 目录 | 下一章`（复用现有 goChapter 逻辑）。
  - 目录入口：source 弹现有目录（若已实现）；local 先禁用。
- **呼出/隐藏**：正文区 `onClick` 切换 `menuVisible`；工具栏始终渲染但可加 `.hidden` 类（CSS transition）。

### 3.3 迁移

- 删除 `SourceReaderPage.tsx`（逻辑并入统一 ReaderPage）。
- `App.tsx`：
  - `reader` 分支 → `<ReaderPage source={{ kind: "local", book }} onBack={...} />`。
  - `sourceReader` 分支 → `<ReaderPage source={{ kind: "source", ...payload }} onBack={...} />`。
  - DetailState 保留两个 variant（载荷不变），仅渲染统一。
- 现有测试更新：`ReaderPage.test.tsx`/`SourceReaderPage.test.tsx` 改为测统一页的 local/source 两分支。

### 3.4 进度显示

- local：reader 组件通过事件上报 `__readerLocation`/percent（现有机制）——底部进度读 `window.__readerPercent`（reader 若有上报）或显示「本地阅读」。
- source：现有 chapter index/total（`chapterIndex` + 目录长度）显示 `x/y 章`。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/reading.ts` | 新建 ReaderSource 类型 |
| `src/pages/ReaderPage.tsx` | 重构为统一外壳 |
| `src/pages/SourceReaderPage.tsx` | 删除（并入统一页） |
| `src/App.tsx` | 两分支渲染统一页 |
| `src/pages/ReaderPage.css` | 底部工具栏样式 |
| `src/pages/ReaderPage.test.tsx` / `SourceReaderPage.test.tsx` | 更新为统一页测试 |

## 5. 测试

- 统一 ReaderPage local 分支：渲染对应 reader（mock 各 reader），返回、TTS、error 处理。
- source 分支：书源加载/正文/漫画/重试/登录（沿用现有 SourceReaderPage 测试逻辑）。
- App：reader/sourceReader 两 detail 分支进统一页。
- 现有测试保持绿（226）。

## 6. 错误处理

- 沿用各渲染组件的 error/移除逻辑。
- 工具栏点击不冒泡到正文区（`e.stopPropagation`）。

## 7. 后续（不在本批）

- R2 翻页引擎、R3 阅读设置面板、R4 目录/书签/标注统一。
