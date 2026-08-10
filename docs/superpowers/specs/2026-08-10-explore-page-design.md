# 子项目1：探索页（ruleExplore）设计文档

日期：2026-08-10
状态：已批准

## 1. 背景与目标

「枕书」已支持 legado 书源的搜索/目录/正文规则。但许多书源主要靠**分类/排行榜浏览**（`exploreUrl` + `ruleExplore`）而非搜索。为对齐 legado 3.0，本子项目实现书源探索页：在「发现」页展示已启用书源的分类入口，点入后浏览该类目书籍列表（支持分页 `{{page}}`），并可进入书籍阅读。

## 2. 非目标

- 不支持音频/漫画（图片章节）—— 见子项目 3
- 不支持登录书源 —— 见子项目 4
- 不实现 legado 的 exploreUrl 内嵌 JS 之外的其它高级语法（随规则引擎子项目推进）

## 3. 技术架构

```
DiscoverPage ──► ExplorePage(书源, 分类)
                  │  parseExploreUrl → 分类列表
                  │  点分类 → httpGet(exploreUrl 填 {{page}})
                  ▼
              解析 ruleExplore → 书籍列表（复用 SearchHit）
                  ▼
              点书 → SourceBookPage（现有）→ 目录 → 正文
```

- `exploreUrl` 解析为分类列表（legado 格式：`分类名::URL` 每行一个，`\n` 分隔；URL 可含 `{{page}}`）。
- `ruleExplore` 规则结构与 `ruleSearch` 一致（`bookList/name/author/coverUrl/bookUrl`），解析复用现有 `extractList`/`extractSingle`。
- 复用现有 `SearchHit` 作为书籍卡片模型与书籍页跳转。

## 4. 文件改动

- **`src/services/bookSourceEngine.ts`**：
  - `export function parseExploreUrl(exploreUrl: string): Array<{ title: string; url: string }>` — 按行解析 `分类名::URL`，`\n` 分隔，忽略空行。
  - `export function extractBookList(doc: Document, rules: Record<string, string>, ctx: { baseUrl?: string; result?: string }): Array<Record<string, string>>` — 从 `ruleSearch`/`ruleExplore` 的 itemRules（bookList/name/author/coverUrl/bookUrl）提取书籍列表。供 DiscoverPage 与 ExplorePage 共用，替代各自内联的 itemRules 构造 + extractList 调用。
- **新建 `src/pages/ExplorePage.tsx`**：
  - Props: `{ sourceId, sourceName, onBack, onOpenBook: (h: SearchHit) => void }`（`SearchHit` 从 DiscoverPage 导出）。
  - 加载书源 → 解析 `exploreUrl` → 显示分类列表（按钮组）。
  - 点分类 → 抓取 `exploreUrl`（替换 `{{page}}`）→ 解析 `ruleExplore` → 书籍列表（复用 `searchSource` 的 itemRules 提取逻辑，抽成共享 helper）。
  - 分页：下一页按钮（`page + 1`，URL 用 `{{page}}`），或书源无分页时隐藏。
- **修改 `src/pages/DiscoverPage.tsx`**：
  - 解析每个已启用书源的 `exploreUrl`，在搜索框下方显示「浏览」入口（书源名 → 分类）。
  - `SearchHit` 导出（已导出）。
  - 路由：App.tsx 增加 `explore` view（carry `sourceId/sourceName`）。
- **修改 `src/App.tsx`**：`explore` view 分支。
- **CSS**：探索页分类按钮、书籍卡片复用现有 `.hit-card` 样式。

## 5. 解析函数详细规则

```ts
// exploreUrl 每行一个分类，格式：分类名::URL（URL 可为绝对或相对，相对基于 bookSourceUrl）
export function parseExploreUrl(exploreUrl: string): Array<{ title: string; url: string }> {
  return exploreUrl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("::");
      if (idx === -1) return { title: line, url: line };
      return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
    });
}
```

- URL 拼接：相对路径基于 `bookSourceUrl`（用 `resolveUrl`）。
- `{{page}}` 替换：抓取时 `url.replace("{{page}}", String(page))`。
- 书籍提取统一走 `extractBookList(doc, itemRules, { baseUrl, result })`，`itemRules` 从 `ruleExplore`（或 `ruleSearch`）取 bookList/name/author/coverUrl/bookUrl。

## 6. 交互细节

- 探索入口：DiscoverPage 在搜索框下、结果区上方，若书源有 `exploreUrl` 则显示该书源名的「浏览」按钮。
- ExplorePage：顶部「书源名」+ 返回；分类按钮网格；点分类加载书籍；「下一页」分页（若 URL 含 `{{page}}`）。
- 加载失败显示中文错误，可重试。

## 7. 测试

- `parseExploreUrl`：标准格式、无 `::`、空行过滤、相对 URL。
- `ExplorePage` 组件：mock httpGet/listBookSources，验证分类渲染、点分类抓取、书籍列表渲染、分页。
- 现有测试保持绿：`npm test`。

## 8. 交付文件

- `src/services/bookSourceEngine.ts`（parseExploreUrl）
- `src/pages/ExplorePage.tsx`（新建）
- `src/pages/DiscoverPage.tsx`（浏览入口）
- `src/App.tsx`（explore view）
- `src/App.css`
- 测试：`bookSourceEngine.test.ts`、`ExplorePage.test.tsx`、`DiscoverPage.test.tsx`

## 9. 已知限制

- exploreUrl 内嵌 `@js:` 的分类 URL 解析依赖现有 evalJs（已支持多语句）。
- 图片/漫画书源的探索结果暂不渲染图片（子项目 3 处理）。
