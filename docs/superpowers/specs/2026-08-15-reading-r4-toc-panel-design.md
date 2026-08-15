# 复刻 legado 阅读体验 R4：阅读页目录面板

日期：2026-08-15
状态：待批准
前置：R1 统一阅读外壳、R2 切片翻页、R3 阅读设置面板完成。

## 1. 目标

书源阅读页顶栏新增「目录」入口，弹出右侧目录面板：展示全书章节列表、高亮当前章节、点击跳转章节；目录数据与书籍页（SourceBookPage）共用同一抓取逻辑，消除重复实现。

## 2. 背景与问题

当前书源书的目录只在书籍页（SourceBookPage）渲染；阅读页（ReaderPage）只有「上一章 / 下一章」按钮，阅读中无法跳转任意章节——这是与 legado 体验的明显断点。

导航链路：Discover/Explore → SourceBookPage（抓目录）→ ReaderPage（只收当前章节信息）。ReaderPage 进入时**没有**目录数据，需要自行获取。

## 3. 非目标

- 不做本地书（EPUB 自带目录/PDF 页导航）的目录面板。
- 不做目录搜索、目录内关键字过滤。
- 不做多书源目录合并（换源属后续迭代）。
- 不做目录缓存持久化（会话内内存缓存即可）。

## 4. 架构

```
sourceToc.ts（共享目录抓取服务，新文件）
  fetchToc({ sourceId, bookUrl, initialTitle }) → { info, toc: TocItem[] }
  逻辑从 SourceBookPage 提取：bookInfo + toc 抓取，返回结构化结果
  内部带内存缓存（key: sourceId:bookUrl）→ 重复进入不重复请求

SourceBookPage：
  改用 fetchToc，删除内联抓取逻辑（行为不变）

ReaderPage：
  - 顶栏 toolbar-actions 加「目录」按钮 → setPanel("toc")
  - 进入时（书源路径）预取目录（fetchToc），打开面板即有数据
  - 面板：`.panel` 右侧栏，章节列表，当前章节高亮，点击 → jumpToChapter(index, url, name)
  - jumpToChapter：重置 prevUrls 栈、setChapter、关闭面板、保存进度
```

### 4.1 共享服务（新文件 src/services/sourceToc.ts）

```ts
export interface TocItem { name: string; url: string }
export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }

export async function fetchToc(opts: {
  sourceId: number;
  bookUrl: string;
  initialTitle: string;
}): Promise<{ info: SourceBookInfo; toc: TocItem[] }>;

export function clearTocCache(): void;  // 测试用
```

- 缓存：`Map<string, Promise<{ info; toc }>>`，key = `${sourceId}:${bookUrl}`。
- 抓取流程（取自 SourceBookPage 现有逻辑）：
  1. `listBookSources` → 找书源 → `parseBookSourceJson`
  2. resolve bookUrl → httpGet（带 UA + cookieJar）
  3. `ruleBookInfo` 提取 title/author/intro/coverUrl
  4. `ruleBookInfo.tocUrl` 或原 URL → httpGet 目录页
  5. `ruleToc.chapterList/chapterName/chapterUrl` → extractList → 解析相对 URL
- 失败：抛错由调用方展示（showError），阅读页目录面板显示空态 + 重试。

### 4.2 ReaderPage 目录面板

- `panel` 类型扩展：`"annotations" | "bookmarks" | "settings" | "toc" | null`。
- 书源路径进入时 useEffect 调 `fetchToc`（cancelled 守卫），存 `toc` state。
- 顶栏按钮：`aria-label="目录"`，`panel === "toc"` 时 active。
- 面板渲染（`.panel.reader-toc-panel`）：
  - 标题「目录」
  - `toc.map` 渲染章节按钮；`chapter.index === idx` 或 `t.url === chapter.url` 高亮（`.active`）。
  - 空态：暂无目录 / 加载中 / 失败重试。
- 点击章节：`jumpToChapter(idx, url, name)`：
  - `prevUrlsRef.current = []`（从目录跳转后上一章从该章节往前）
  - `setChapter({ index: idx, url, name })`
  - `setPanel(null)` 关闭面板
  - `nextUrlRef.current = ""`（下一章重新抓取）
- 目录加载失败：面板内显示错误 + 重试按钮（重新 fetchToc 且清缓存 key）。

### 4.3 数据流

```
ReaderPage mount（书源）
  → useEffect: fetchToc(sourceId, bookUrl, bookTitle)
  → toc state
  → 点目录按钮 → 面板显示 toc
  → 点章节 → setChapter → loadChapter 重新抓正文 → PaginatedReader 重渲染
```

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/sourceToc.ts` | 新建：fetchToc/TocItem/SourceBookInfo/缓存 |
| `src/services/sourceToc.test.ts` | 新建：缓存/抓取/失败测试 |
| `src/pages/SourceBookPage.tsx` | 改用 fetchToc，删除内联逻辑 |
| `src/pages/ReaderPage.tsx` | 目录按钮 + 面板 + jumpToChapter |
| `src/pages/ReaderPage.css` | 目录面板/高亮样式 |
| `src/pages/ReaderPage.source.test.tsx` | 目录面板测试 |
| `src/pages/SourceBookPage.test.tsx` | 适配 fetchToc（行为不变） |

## 6. 测试

- sourceToc：缓存命中不重复请求、首次抓取返回 info+toc、失败抛错、clearTocCache。
- ReaderPage：目录按钮开合、目录列表渲染、当前章节高亮、点击跳转（正文切换 + prevUrls 重置）、失败重试。
- SourceBookPage 现有测试保持绿（适配后行为不变）。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 书源不存在 → showError，面板空态。
- 目录抓取失败 → 面板显示失败 + 重试按钮。
- 章节跳转后正文加载失败 → 复用现有 loadChapter 失败路径（重试按钮）。
