# 复刻 legado 阅读体验 R6：换源（多书源切换）

日期：2026-08-15
状态：待批准
前置：R1-R5 完成。

## 1. 目标

同一本书可在多个书源间切换：从当前书（书名 + 作者）出发，在其它启用书源并发搜索候选，用户选择目标源后打开该书的新源版本（书籍页 / 直接阅读）。书籍详情页与阅读页均提供「换源」入口。

## 2. 背景与问题

当前一本书固定来自一个书源；书源失效/内容不全时无法换到其它源。legado 的核心体验之一就是"换源"：以书名搜全站，聚合同书不同源，随时切换且进度按源独立保存。

## 3. 非目标

- 不做跨源进度迁移（换源后从新源第一章或按章节名定位续读——见 §4.4，不做百分比迁移）。
- 不做多源目录合并展示。
- 不做"换源后自动定位到当前章节"的精确匹配（仅名称匹配，最佳匹配命中即跳）。
- 不做换源去重合并（同源多结果保留）。

## 4. 架构

```
共享搜索服务（抽自 DiscoverPage，新文件 src/services/searchService.ts）
  searchBookSources(query, { sourceIds? }) → SearchHit[]
  - 复用现有 searchSource 逻辑（resolveSearchUrl + httpGet + extractBookList）
  - 支持指定 sourceIds（换源时排除当前源）

DiscoverPage：改用共享服务（行为不变）

换源面板（新组件 src/components/SwitchSourcePanel.tsx）
  - props: { title, author, excludeSourceId, onPick(hit), onClose }
  - 挂载时自动以书名（+作者）搜索其它启用书源
  - 展示候选（书名/作者/来源），点击 → onPick

SourceBookPage：书籍信息区「换源」按钮 → 打开换源面板 → onPick → 打开新源 SourceBookPage（或 onSwitchSource 回调）
ReaderPage：顶栏「换源」按钮 → 同上

App.tsx：sourceBook 状态支持从换源面板直接切换到另一本书（onSwitchSource 回调）
```

### 4.1 共享搜索服务（src/services/searchService.ts）

```ts
export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

export async function searchBookSources(query: string, opts?: {
  sourceIds?: number[];      // 限定书源（换源时排除当前源）
}): Promise<SearchHit[]>;
```

- 逻辑 = 现有 DiscoverPage `searchSource`（逐源 Promise.all，单源失败降级空数组）。
- 换源场景传 `sourceIds: 排除当前源`。

### 4.2 换源面板（src/components/SwitchSourcePanel.tsx）

- 挂载 effect：`searchBookSources(`${title} ${author}`.trim(), { sourceIds: exclude 之外的启用源 })`。
- UI：面板标题「换源：{title}」、加载态、空态（"未在其它书源找到该书"）、候选列表（书名/作者/来源名）。
- 点击候选 → `onPick(hit)`；「取消」→ `onClose()`。
- 复用现有 `.panel` / `.hit-card` 样式。

### 4.3 入口与路由

- **SourceBookPage**：meta 区「换源」按钮（加入书架旁）。本地 state `showSwitch` 控制面板。`onPick` → 调用 `onSwitchSource(hit)` prop（App 层切换到新书 sourceBook）。
- **ReaderPage**（书源路径）：顶栏「换源」按钮（加入书架旁）。`onPick` → `onSwitchSource(hit)`。
- **App.tsx**：`sourceBook` 详情增加 `onSwitchSource={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state.back })}`；`sourceReader` 同样传 `onSwitchSource`（换源后进入新书详情页，用户再点阅读）。

### 4.4 换源后续读策略

- 换源后进入**新书的书籍详情页**（SourceBookPage），由用户选择章节开始阅读——避免跨源 URL 映射的复杂性，同时保留"换源后从新源目录选章"的 legado 语义。
- 阅读进度已按 `(source_id, book_url)` 独立保存（R1 现有表），换源后各源进度互不干扰，回切原源时进度仍在。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/searchService.ts` | 新建：searchBookSources |
| `src/services/searchService.test.ts` | 新建：搜索/过滤/失败降级测试 |
| `src/pages/DiscoverPage.tsx` | 改用共享服务 |
| `src/components/SwitchSourcePanel.tsx` | 新建：换源面板 |
| `src/components/SwitchSourcePanel.test.tsx` | 新建：面板测试 |
| `src/pages/SourceBookPage.tsx` | 换源按钮 + 面板 |
| `src/pages/ReaderPage.tsx` | 换源按钮 + 面板 |
| `src/App.tsx` | onSwitchSource 路由 |
| 各测试文件 | 适配 |

## 6. 测试

- searchService：多源并发搜索、sourceIds 过滤、单源失败降级。
- SwitchSourcePanel：自动搜索、候选渲染、点击回调、空态/失败态。
- SourceBookPage / ReaderPage：换源按钮打开面板、onPick 回调。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 搜索失败（网络/超时）→ 面板显示失败 + 重试按钮。
- 全部书源无结果 → 空态提示。
- 当前书无作者 → 仅按书名搜索。
