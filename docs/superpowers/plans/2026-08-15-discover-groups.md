# 发现页 R13：探索入口按分组聚合（频道形态） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发现页探索区从「平铺 261 个书源按钮」改为「按分组聚合的频道卡片」，点击分组进入组内书源列表页，再进书源浏览页。

**Architecture:** DiscoverPage 聚合探索源为分组频道；新建 GroupExplorePage（组内书源列表）；App 加 groupExplore 路由。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 保留搜索框 + 探索区 + 结果列表结构；不做整页重构。
- 分组逻辑复用 BookSourceManager.groupSources 的语义（逗号分隔多分组）。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/pages/DiscoverPage.tsx` | 分组聚合 + onOpenGroupExplore | 修改 |
| `src/pages/GroupExplorePage.tsx` | 组内书源列表 | 新建 |
| `src/App.tsx` | groupExplore 路由 | 修改 |
| `src/App.css` | 分组频道样式 | 修改 |
| `src/pages/DiscoverPage.test.tsx` | 分组聚合测试 | 修改 |
| `src/pages/GroupExplorePage.test.tsx` | 新建测试 | 新建 |

## 任务依赖

Task 1（DiscoverPage 聚合）→ Task 2（GroupExplorePage + 路由）→ Task 3（样式 + 测试）→ Task 4（验证）。

---

### Task 1: DiscoverPage 探索区分组聚合

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`
- Test: `src/pages/DiscoverPage.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // props 加
  onOpenGroupExplore?: (groupName: string, sources: Array<{ id: number; name: string }>) => void;
  // 导出聚合函数（供测试）
  export function groupExploreSources(sources: Array<{ id: number; name: string; json: string }>): Array<{ group: string; sources: Array<{ id: number; name: string }> }>;
  ```

- [ ] **Step 1: 写失败测试（DiscoverPage.test.tsx 追加）**

```tsx
import { groupExploreSources } from "./DiscoverPage";

describe("groupExploreSources", () => {
  it("groups explore sources by bookSourceGroup splitting multi groups", () => {
    const sources = [
      { id: 1, name: "源A", json: JSON.stringify({ bookSourceGroup: "小说" }) },
      { id: 2, name: "源B", json: JSON.stringify({ bookSourceGroup: "小说, 玄幻" }) },
      { id: 3, name: "源C", json: JSON.stringify({}) },
    ];
    const groups = groupExploreSources(sources as any);
    expect(groups.find((g) => g.group === "小说")?.sources.length).toBe(2);
    expect(groups.find((g) => g.group === "玄幻")?.sources.length).toBe(1);
    expect(groups.find((g) => g.group === "未分组")?.sources.length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx`
Expected: FAIL（groupExploreSources 未导出）

- [ ] **Step 3: 实现聚合**

```ts
export interface ExploreSource { id: number; name: string }
export interface ExploreGroup { group: string; sources: ExploreSource[] }

export function groupExploreSources(sources: Array<{ id: number; name: string; json: string }>): ExploreGroup[] {
  const map = new Map<string, ExploreSource[]>();
  const add = (g: string, s: ExploreSource) => {
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  };
  for (const s of sources) {
    let groups: string[] = [];
    try {
      const parsed = JSON.parse(s.json);
      groups = String(parsed?.bookSourceGroup ?? "").split(",").map((g) => g.trim()).filter(Boolean);
    } catch { /* 归未分组 */ }
    if (groups.length === 0) add("未分组", { id: s.id, name: s.name });
    else for (const g of groups) add(g, { id: s.id, name: s.name });
  }
  // 组按书源数降序
  return [...map.entries()]
    .map(([group, items]) => ({ group, sources: items }))
    .sort((a, b) => b.sources.length - a.sources.length);
}
```

- 组件内：exploreSources 状态改为存原始 `Array<{ id, name, json }>`（有 exploreUrl 的），渲染前 groupExploreSources。

```tsx
const [exploreSources, setExploreSources] = useState<Array<{ id: number; name: string; json: string }>>([]);
// effect 里 push { id: s.id, name: s.name, json: s.json }（s.json 已有）
const groups = groupExploreSources(exploreSources);
```

- 渲染（替换 `.explore-entry` 平铺）：

```tsx
{groups.length > 0 && onOpenExplore && (
  <div className="explore-groups">
    <h2 className="home-section">书源频道</h2>
    {groups.map((g) => (
      <button key={g.group} className="group-channel" onClick={() => onOpenGroupExplore?.(g.group, g.sources)}>
        <span className="group-name">{g.group}</span>
        <span className="count">{g.sources.length}</span>
      </button>
    ))}
  </div>
)}
```

注意：`onOpenGroupExplore` 可选；若无该 prop 但 onOpenExplore 存在，可退化为直接进第一个源？**不退化**——要求调用方传 onOpenGroupExplore（App 层保证）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx`
Expected: 全绿（含新增 1）

- [ ] **Step 5: Commit**

```bash
git add src/pages/DiscoverPage.tsx src/pages/DiscoverPage.test.tsx
git commit -m "feat: 发现页探索入口按分组聚合"
```

---

### Task 2: GroupExplorePage + 路由

**Files:**
- Create: `src/pages/GroupExplorePage.tsx`
- Test: `src/pages/GroupExplorePage.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: GroupExplorePage**

```tsx
import type { ExploreSource } from "./DiscoverPage";

export default function GroupExplorePage({ groupName, sources, onBack, onOpenExplore }: {
  groupName: string;
  sources: ExploreSource[];
  onBack: () => void;
  onOpenExplore: (sourceId: number, sourceName: string) => void;
}) {
  return (
    <div className="discover explore page">
      <header className="library-header">
        <div className="brand"><h1>{groupName} · 书源</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      {sources.length === 0 ? (
        <p className="panel-empty">该分组暂无书源</p>
      ) : (
        <div className="discover-results">
          {sources.map((s) => (
            <div className="hit-card" key={s.id} onClick={() => onOpenExplore(s.id, s.name)}>
              <div className="hit-info">
                <span className="hit-title">{s.name}</span>
              </div>
              <span className="hit-source">浏览</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx 路由**

- DetailState 加：`| { area: "detail"; page: "groupExplore"; groupName: string; sources: ExploreSource[]; back: AppArea }`。
- import `type { ExploreSource } from "./pages/DiscoverPage"` 与 GroupExplorePage。
- DiscoverPage 调用处加 `onOpenGroupExplore={(g, sources) => setState({ area: "detail", page: "groupExplore", groupName: g, sources, back: "discover" })}`。
- case "groupExplore": 渲染 GroupExplorePage，onOpenExplore → 现有 explore 路由。

- [ ] **Step 3: GroupExplorePage.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import GroupExplorePage from "./GroupExplorePage";

describe("GroupExplorePage", () => {
  it("renders group name and source list", () => {
    render(<GroupExplorePage groupName="小说" sources={[{ id: 1, name: "源A" }, { id: 2, name: "源B" }]} onBack={() => {}} onOpenExplore={() => {}} />);
    expect(screen.getByText(/小说 · 书源/)).toBeInTheDocument();
    expect(screen.getByText("源A")).toBeInTheDocument();
    expect(screen.getByText("源B")).toBeInTheDocument();
  });

  it("opens a source via onOpenExplore", () => {
    const onOpenExplore = vi.fn();
    render(<GroupExplorePage groupName="小说" sources={[{ id: 1, name: "源A" }]} onBack={() => {}} onOpenExplore={onOpenExplore} />);
    fireEvent.click(screen.getByText("源A"));
    expect(onOpenExplore).toHaveBeenCalledWith(1, "源A");
  });

  it("shows empty state", () => {
    render(<GroupExplorePage groupName="空组" sources={[]} onBack={() => {}} onOpenExplore={() => {}} />);
    expect(screen.getByText(/该分组暂无书源/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/GroupExplorePage.test.tsx src/App.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/pages/GroupExplorePage.tsx src/pages/GroupExplorePage.test.tsx src/App.tsx
git commit -m "feat: 分组书源浏览页与路由"
```

---

### Task 3: 样式

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: 分组频道样式**

```css
/* ============ 发现页书源频道 ============ */
.explore-groups { max-width: 720px; margin: 0 0 24px; }
.explore-groups .home-section { margin-top: 0; }
.explore-channels { display: flex; flex-wrap: wrap; gap: 10px; }
.group-channel {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); background: var(--surface-container-lowest);
  font-size: 14px; color: var(--on-surface); font-weight: 500;
  cursor: pointer; transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.12s ease;
}
.group-channel:hover { border-color: var(--primary); background: var(--secondary-container); }
.group-channel:active { transform: translateY(1px); }
.group-channel .count {
  font-size: 11.5px; color: var(--on-surface-variant);
  background: var(--surface-container-high); border-radius: 999px; padding: 2px 8px;
  font-weight: 500;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "style: 发现页分组频道样式"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 groupExploreSources 1、GroupExplorePage 3）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] DiscoverPage 探索源分组聚合 + 1 测试 ✓
- [ ] GroupExplorePage + 3 测试 ✓
- [ ] App groupExplore 路由 ✓
- [ ] 样式 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 发现页分组终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 发现页分组终审修复"
```

---
