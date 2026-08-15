# 复刻 legado 发现页 R13：探索入口按分组聚合（频道形态）

日期：2026-08-15
状态：待批准
前置：书源管理/导入/导出/订阅完成。

## 1. 目标

解决发现页探索入口爆炸问题：274 个启用书源中 261 个有 exploreUrl，当前全部平铺「浏览 XX」按钮导致页面混乱。改为**按书源分组聚合的频道形态**（对齐 legado 原版发现页）：探索区显示去重后的分组频道，点击分组进入组内书源列表，再点书源进入其浏览页。

## 2. 背景与问题

当前 DiscoverPage 把每个有 exploreUrl 的书源渲染成一个「浏览 {书源名}」按钮（`.explore-entry` 平铺 261 个），页面变成按钮墙。legado 原版发现页是频道导航：分组/分类聚合，用户先选频道再浏览，而非所有书源平铺。

## 3. 非目标

- 不做发现页整页重构（保留搜索框 + 探索区 + 结果列表结构）。
- 不做书源推荐/排行/精选。
- 不做频道搜索。

## 4. 架构

```
DiscoverPage 探索区改造：
  exploreSources（现有）→ 按 bookSourceGroup 聚合为分组频道
  GroupedExplore = Array<{ group: string; sources: Array<{ id, name }> }>

  - 未搜索时：探索区渲染「分组频道」chips/卡片（每组一个入口，不展开书源）
    - 组名 + 书源数徽标（如「小说 224」）
  - 点击分组 → onOpenGroupExplore(groupName, groupId 列表或 source 列表)
    进入 GroupExplorePage（新页）：列出该组全部书源 → 点击进 ExplorePage 浏览

App.tsx：新增 detail 状态 groupExplore（groupName + sources 数组）→ GroupExplorePage
GroupExplorePage：书源列表（复用 hit-card 样式），点击 → ExplorePage
```

### 4.1 分组聚合（DiscoverPage）

```ts
// 复用 BookSourceManager.groupSources 的分组逻辑（拆分多分组）
function groupExploreSources(sources: Array<{ id: number; name: string }>): Array<{ group: string; sources: Array<{ id: number; name: string }> }> {
  // 遍历书源 JSON 的 bookSourceGroup（逗号分隔 → 多分组），同组聚合
}
```

- 组顺序：按组内书源数降序（大组在前）或按名称；**书源数降序**更实用（原版也常见）。
- 组渲染：`.group-channel` 卡片/chips 网格（flex-wrap），组名 + 计数徽标。

### 4.2 GroupExplorePage（新页）

```tsx
export default function GroupExplorePage({ groupName, sources, onBack, onOpenExplore }: {
  groupName: string;
  sources: Array<{ id: number; name: string }>;
  onBack: () => void;
  onOpenExplore: (sourceId: number, sourceName: string) => void;
}) {
  // header: {groupName} · 浏览
  // 书源列表（hit-card 样式）：名称 + 箭头，点击 onOpenExplore
}
```

### 4.3 App 路由

- DetailState 加 `{ area: "detail"; page: "groupExplore"; groupName: string; sources: Array<{ id: number; name: string }>; back: AppArea }`。
- DiscoverPage 加 prop `onOpenGroupExplore(groupName, sources)` → 路由到 GroupExplorePage。
- GroupExplorePage onOpenExplore → 路由到 explore（现有）。

### 4.4 样式（App.css）

```css
.explore-groups { display: flex; flex-wrap: wrap; gap: 10px; max-width: 720px; margin: 0 0 24px; }
.group-channel {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); background: var(--surface-container-lowest);
  cursor: pointer; transition: ...;
}
.group-channel:hover { border-color: var(--primary); background: var(--secondary-container); }
.group-channel .count { font-size: 11.5px; color: var(--on-surface-variant); background: var(--surface-container-high); border-radius: 999px; padding: 2px 8px; }
```

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/pages/DiscoverPage.tsx` | 探索区按分组聚合 + onOpenGroupExplore prop |
| `src/pages/GroupExplorePage.tsx` | 新建：组内书源列表 |
| `src/App.tsx` | groupExplore 路由 |
| `src/App.css` | 分组频道样式 |
| `src/pages/DiscoverPage.test.tsx` | 分组聚合测试 |
| `src/pages/GroupExplorePage.test.tsx` | 新建测试 |
| `src/App.test.tsx` | 适配（若受影响） |

## 6. 测试

- DiscoverPage：探索源按分组聚合（多分组拆分、计数）、未搜索时显示分组频道、点击分组回调。
- GroupExplorePage：渲染组名与书源列表、点击书源回调。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 书源 JSON 解析失败 → 归「未分组」。
- 分组为空（无 exploreUrl 书源）→ 探索区不渲染。
- GroupExplorePage sources 为空 → 空态提示。
