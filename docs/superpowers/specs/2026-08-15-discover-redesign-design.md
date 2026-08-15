# 发现页重新设计 R16：复刻 legado 频道导航

日期：2026-08-15
状态：待批准
前置：R13 分组聚合基础。

## 1. 目标

重新设计发现页为 legado 频道导航形态：顶部常驻搜索框 →「书源频道」信息卡片网格（分组名 + 书源数 + 代表书源名）→ 搜索结果按书源分组收敛。解决当前"功能堆叠、层级不清"的问题。

## 2. 设计原则（frontend-design）

- **Hick's Law**：搜索与浏览两个任务分离，一次只看一类内容。
- **Miller's Law**：频道按分组聚合（~9 组），不用 261 个书源轰炸。
- **Von Restorff**：搜索框为唯一主 CTA，视觉最突出。
- **层级**：搜索（主）→ 频道（浏览入口）→ 结果（任务输出）。
- 遵循现有 MD3 主题令牌（--primary/--surface-container 等），不做全新配色。

## 3. 现状与问题

当前发现页：标题 → 搜索框 → 「书源频道」chips（分组名+计数）→ 结果列表。
问题：chips 信息量低（只有组名+数字）、搜索结果同书多源平铺刷屏、空态/加载态缺失。

## 4. 架构

```
DiscoverPage 重设计：
  1. 头部：标题「发现」+ 搜索框（突出，flex 全宽）
  2. 频道区（未搜索时）：
     网格卡片 .channel-card（2-3 列自适应）
     每卡：分组 emoji/首字符徽标 + 组名 + 「N 个书源」+ 代表书源名（该组第一个书源名，截断）
     点击 → onOpenGroupExplore（进入分组书源列表）
  3. 结果区（搜索后）：
     搜索结果按 书名+作者 聚合（同书多源合并）
     每结果卡：标题 + 作者 + 「N 个来源」徽标，点击 → 打开来源选择（或直接打开第一个源）
  4. 空态：无书源时「导入书源」引导；无搜索结果时「未找到」。
```

### 4.1 频道卡片（ExploreGroup → ChannelCard）

```tsx
interface ChannelCard {
  group: string;
  count: number;
  representative: string;  // 组内第一个书源名
  icon: string;            // 组名首个 emoji/字符（无则取组名首字符）
}
```

- 图标：从组名提取首个 emoji（正则 `/\p{Extended_Pictographic}/u`）或取首字符。
- 网格：`display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`。

### 4.2 搜索结果聚合（SearchHit → 合并）

```ts
interface GroupedHit {
  title: string;
  author: string;
  sources: Array<{ sourceId: number; sourceName: string; bookUrl: string; coverUrl: string }>;
}
```

聚合键：`title + "|" + author`（归一化：trim、去首尾空白）。
- 同书多源 → 一个卡片，来源徽标显示「N 个来源」。
- 点击 → 展开来源列表（小浮层）或直接打开第一个源。**本批：点击卡片打开第一个源；卡片下方显示来源名列表（可点）**——更直观。

### 4.3 状态

- 未搜索：显示频道网格。
- 搜索中：spinner。
- 有结果：聚合卡片。
- 无结果：空态「未找到相关书籍，试试其他关键词」。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/pages/DiscoverPage.tsx` | 频道卡片 + 结果聚合 + 空态 |
| `src/pages/DiscoverPage.test.tsx` | 适配 + 新增用例 |
| `src/App.css` | channel-card 网格 / result-card / 聚合样式 |
| `src/components/GroupExplorePage.tsx` | 不变（频道卡片点击仍走 groupExplore） |

## 6. 测试

- 频道卡片渲染：分组名/计数/代表书源名。
- 结果聚合：同书多源合并、不同书分开。
- 空态：无结果提示。
- 现有测试适配（explore-entry 相关断言改为 channel-card）。

## 7. 错误处理

- 无探索书源 → 频道区隐藏，仅搜索框。
- 搜索失败 → showError（现有）。
- 代表书源名超长 → CSS 截断。
