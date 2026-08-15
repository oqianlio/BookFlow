# 探索页左右分栏 R17：分类与书籍列表分离

日期：2026-08-15
状态：已批准（用户确认左右分栏）

## 1. 目标

书源探索页（ExplorePage）从「上下堆叠（分类 chips + 下方书籍列表）」改为**左右分栏**：左侧固定分类导航栏（竖排、可滚动、激活态），右侧书籍列表区（独立滚动、点分类刷新、分页）。

## 2. 设计

```
.explore-layout（flex，max-width 1080px）
├── .explore-side（固定 200px，sticky top，独立滚动）
│   ├── 「分类」小标题
│   └── .explore-cat-list（竖排分类项，hover/active 态）
└── .explore-main（flex 1，min-width 0）
    └── .discover-results（书籍列表 + 分页）
```

- 分类项 `.explore-cat-item`：整行可点、省略号截断长分类名、active 用 `--secondary-container` 高亮。
- 侧栏 `position: sticky; top: 16px; max-height: calc(100vh - 140px); overflow-y: auto`——分类多时可独立滚动，不随书籍滚动。
- 逻辑不变：`loadCategory(c, 1)` 点击刷新右侧；`{{page}}` 分类显示「下一页」。

## 3. 文件修改

| 文件 | 动作 |
|---|---|
| `src/pages/ExplorePage.tsx` | 渲染改左右分栏 |
| `src/App.css` | explore-layout/side/main/cat-list 样式 |
| `src/pages/ExplorePage.test.tsx` | 新增布局+激活态用例 |

## 4. 验证

- 全量 `npm test` 332 通过、`npm run build` 通过、既有测试不回归。
