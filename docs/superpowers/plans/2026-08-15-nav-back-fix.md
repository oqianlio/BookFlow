# 导航返回修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** back 从根区域改为上层完整状态，返回逐级回退。

**Architecture:** App.tsx 内 DetailState.back 改 `AppState`；新增 `rootArea`；所有导航点 back 传当前 state；阅读页 onBack 直接恢复上层。

**Tech Stack:** React 19 + TypeScript + vitest。无 Rust 改动。

## Global Constraints

- 不改 SideNav；不做前进历史。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/App.tsx` | back 类型 + rootArea + 导航点 | 修改 |
| `src/App.test.tsx` | 适配 + 多级返回用例 | 修改 |

## 任务依赖

Task 1（类型与辅助）→ Task 2（导航点改造）→ Task 3（测试）→ Task 4（验证）。

---

### Task 1: 类型与 rootArea

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: back 类型改 AppState + rootArea**

```tsx
type DetailState =
  | { area: "detail"; page: "reader"; book: Book; back: AppState }
  | { area: "detail"; page: "explore"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "debugSource"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "sourceManager"; back: AppState }
  | { area: "detail"; page: "sourceBook"; hit: SearchHit; back: AppState }
  | { area: "detail"; page: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string; back: AppState }
  | { area: "detail"; page: "rssArticle"; articleId: number; back: AppState }
  | { area: "detail"; page: "groupExplore"; groupName: string; sources: ExploreSource[]; back: AppState };

type AppState = { area: AppArea } | DetailState;

// 递归取根区域（侧边栏高亮）
function rootArea(s: AppState): AppArea {
  return s.area === "detail" ? rootArea(s.back) : s.area;
}
```

- [ ] **Step 2: 运行确认（tsc 报错预期）**

Run: `npx tsc --noEmit`
Expected: FAIL（导航点 back 传 string 不匹配 AppState）

---

### Task 2: 导航点改造

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 根区域高亮**

```tsx
const area = rootArea(state);   // 替换 state.area === "detail" ? state.back : state.area
```

- [ ] **Step 2: 各导航点 back 传当前 state**

统一模式：进入详情时 `back: state`（state 是当前完整状态）。

| 位置 | 改法 |
|---|---|
| reader (local): `back: "bookshelf"` | `back: state` |
| sourceBook (discover): `back: "discover"` | `back: state` |
| explore (discover): `back: "discover"` | `back: state` |
| groupExplore (discover): `back: "discover"` | `back: state` |
| groupExplore→explore: `back: state.back` | `back: state` |
| explore→sourceBook: `back: state.back` | `back: state` |
| sourceBook→sourceReader: `back: state.back` | `back: state` |
| sourceBook 换源: `back: state.back` | `back: state` |
| sourceReader 换源: `back: state.back` | `back: state` |
| bookshelf→sourceReader: `back: "bookshelf"` | `back: state` |
| rssArticle: `back: "rss"` | `back: state` |
| sourceManager: `back: "my"` | `back: state` |
| sourceManager→debugSource: `back: "my"` | `back: state` |

- [ ] **Step 3: 阅读页 onBack 修正**

```tsx
case "sourceReader":
  return (
    <ReaderPage
      source={{ ... }}
      onBack={() => setState(state.back)}   // 直接恢复进入阅读前的上层状态
      onSwitchSource={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state })}
    />
  );
```

（删除原构造 sourceBook 的 onBack 逻辑——阅读返回应回到上层，无论上层是 sourceBook 还是书架 sourceReader 入口。）

- [ ] **Step 4: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 通过

---

### Task 3: 测试

**Files:**
- Modify: `src/App.test.tsx`

- [ ] **Step 1: 现有用例适配**

- App.test.tsx 的 api mock 已含列表函数；导航用例「switches areas via side nav」不受 back 类型影响，应保持绿。
- 检查是否有用例断言 back 行为——现有无。

- [ ] **Step 2: 新增多级返回用例**

```tsx
it("returns step by step through nested navigation", async () => {
  render(<App />);
  // 发现 → 分组频道
  await userEvent.click(screen.getByRole("button", { name: /发现/ }));
  // mock 书源数据需含 exploreUrl + group
  // ...（需要给 App.test 的 api mock 提供 listBookSources 返回值）
});
```

注意：App.test.tsx 目前 mock `listBookSources: vi.fn().mockResolvedValue([])`——发现页没有探索源。为测多级导航，需要 mock listBookSources 返回带 exploreUrl+group 的书源。改造：

```tsx
listBookSources: vi.fn().mockResolvedValue([
  { id: 1, name: "源A", url: "https://a.com", json: JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A", exploreUrl: "分类::/x.html", bookSourceGroup: "小说" }), enabled: true, last_used_at: null },
]),
```

然后用例：

```tsx
it("returns step by step through group explore", async () => {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: /发现/ }));
  await screen.findByText("书源频道");
  await userEvent.click(screen.getByText("小说"));
  // 分组页
  expect(await screen.findByText(/小说 · 书源/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("源A"));
  // 书源浏览页
  expect(await screen.findByText(/源A · 浏览/)).toBeInTheDocument();
  // 逐级返回
  await userEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(await screen.findByText(/小说 · 书源/)).toBeInTheDocument();   // 回到分组页
  await userEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(await screen.findByText("书源频道")).toBeInTheDocument();        // 回到发现页
});
```

注意：ExplorePage 挂载会 httpGet 书源页——App.test 需 mock `httpGet`（当前未 mock）。给 api mock 补 `httpGet: vi.fn().mockResolvedValue("<html><body></body></html>")`。

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run src/App.test.tsx`
Expected: 全绿（现有 + 新增）

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] back 类型改 AppState + rootArea ✓
- [ ] 所有导航点 back 传当前 state ✓
- [ ] sourceReader onBack 恢复上层 ✓
- [ ] App.test 新增多级返回用例 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 导航返回终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 导航返回终审修复"
```

---
