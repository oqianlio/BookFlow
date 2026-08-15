# 发现页重新设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发现页复刻 legado 频道导航：频道卡片网格 + 搜索结果聚合 + 空态。

**Architecture:** DiscoverPage 渲染改造 + 聚合函数；App.css 样式；测试适配。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 遵循 MD3 主题令牌，不引入新配色。
- GroupExplorePage 导航不变（onOpenGroupExplore 签名不变）。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/pages/DiscoverPage.tsx` | 频道卡片 + 聚合 + 空态 | 修改 |
| `src/pages/DiscoverPage.test.tsx` | 适配 + 新增 | 修改 |
| `src/App.css` | 频道网格/结果聚合样式 | 修改 |

## 任务依赖

Task 1（聚合函数）→ Task 2（渲染改造）→ Task 3（样式）→ Task 4（测试）→ Task 5（验证）。

---

### Task 1: 聚合函数（导出可测）

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`

- [ ] **Step 1: 频道卡片聚合**

```ts
export interface ChannelCard {
  group: string;
  count: number;
  representative: string;
  icon: string;
}

function emojiOf(name: string): string {
  const m = name.match(/\p{Extended_Pictographic}/u);
  if (m) return m[0];
  return name.trim().charAt(0) || "📚";
}

export function toChannelCards(groups: ExploreGroup[]): ChannelCard[] {
  return groups.map((g) => ({
    group: g.group,
    count: g.sources.length,
    representative: g.sources[0]?.name ?? "",
    icon: emojiOf(g.group),
  }));
}
```

- [ ] **Step 2: 结果聚合**

```ts
export interface GroupedHit {
  title: string;
  author: string;
  sources: SearchHit[];
}

export function groupSearchHits(hits: SearchHit[]): GroupedHit[] {
  const map = new Map<string, GroupedHit>();
  for (const h of hits) {
    const key = `${h.title.trim()}|${(h.author ?? "").trim()}`;
    const existing = map.get(key);
    if (existing) existing.sources.push(h);
    else map.set(key, { title: h.title, author: h.author, sources: [h] });
  }
  return [...map.values()];
}
```

- [ ] **Step 3: tsc 通过**

Run: `npx tsc --noEmit`

---

### Task 2: 渲染改造

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`

- [ ] **Step 1: 频道区**

```tsx
{groups.length > 0 && onOpenExplore && (
  <section className="discover-channels">
    <div className="section-head">
      <h2 className="home-section">书源频道</h2>
      <span className="section-sub">{exploreSources.length} 个书源可浏览</span>
    </div>
    <div className="channel-grid">
      {toChannelCards(groups).map((c) => (
        <button key={c.group} className="channel-card" onClick={() => {
          const g = groups.find((x) => x.group === c.group);
          if (g) onOpenGroupExplore?.(g.group, g.sources);
        }}>
          <span className="channel-icon">{c.icon}</span>
          <div className="channel-body">
            <span className="channel-name">{c.group}</span>
            <span className="channel-sub">{c.count} 个书源{c.representative ? ` · ${c.representative}` : ""}</span>
          </div>
        </button>
      ))}
    </div>
  </section>
)}
```

- [ ] **Step 2: 结果区（聚合）**

```tsx
<div className="discover-results">
  {busy ? (
    <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>搜索中…</span></span></p>
  ) : query.trim() && hits.length === 0 ? (
    <p className="panel-empty">未找到相关书籍，试试其他关键词</p>
  ) : !query.trim() && hits.length === 0 ? (
    <p className="panel-empty">输入书名，跨书源搜索</p>
  ) : (
    groupSearchHits(hits).map((g, i) => (
      <div className="hit-card result-card" key={i}>
        <div className="hit-info" onClick={() => onOpenBook(g.sources[0])}>
          <span className="hit-title">{g.title}</span>
          <span className="hit-author">{g.author || (g.sources.length > 1 ? `来自 ${g.sources.length} 个书源` : g.sources[0]?.sourceName)}</span>
        </div>
        <div className="result-sources">
          {g.sources.map((s) => (
            <button key={`${s.sourceId}-${s.bookUrl}`} className="result-source" onClick={() => onOpenBook(s)}>{s.sourceName}</button>
          ))}
        </div>
      </div>
    ))
  )}
</div>
```

- [ ] **Step 3: tsc 通过**

Run: `npx tsc --noEmit`

---

### Task 3: 样式（App.css）

- [ ] **Step 1: 频道网格**

```css
/* ============ 发现页频道导航（legado 形态） ============ */
.discover-channels { max-width: 860px; margin: 0 0 28px; }
.section-head { display: flex; align-items: baseline; gap: 12px; margin: 4px 0 14px; }
.section-head .home-section { margin: 0; }
.section-sub { font-size: 12.5px; color: var(--on-surface-variant); }
.channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.channel-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md);
  background: var(--surface-container-lowest);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
}
.channel-card:hover {
  border-color: var(--primary);
  background: var(--surface-container-low);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}
.channel-card:active { transform: translateY(0); }
.channel-icon {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  background: var(--secondary-container);
  border-radius: 12px;
}
.channel-body { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.channel-name { font-size: 14px; font-weight: 600; color: var(--on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-sub { font-size: 11.5px; color: var(--on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 搜索结果聚合 */
.result-card { flex-direction: column; align-items: stretch; gap: 8px; }
.result-card .hit-info { cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.result-sources { display: flex; flex-wrap: wrap; gap: 6px; }
.result-source {
  font-size: 11px; color: var(--primary);
  background: var(--secondary-container);
  border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer;
}
.result-source:hover { background: var(--primary-container); }
```

- [ ] **Step 2: Commit（样式与渲染一起提交）**

```bash
git add src/pages/DiscoverPage.tsx src/App.css
git commit -m "feat: 发现页复刻 legado 频道导航（卡片网格 + 搜索结果聚合）"
```

---

### Task 4: 测试

**Files:**
- Modify: `src/pages/DiscoverPage.test.tsx`

- [ ] **Step 1: 适配现有用例**

- 「shows explore entry」断言 `浏览 有浏览` → 改为频道卡片断言（`.channel-card` 或组名「未分组」）。
- 「opens a group channel」仍走 onOpenGroupExplore（签名不变）。

- [ ] **Step 2: 新增用例**

```tsx
import { groupSearchHits, toChannelCards } from "./DiscoverPage";

describe("groupSearchHits", () => {
  it("merges same-title same-author hits across sources", () => {
    const hits = [
      { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://a.com/1", sourceId: 1, sourceName: "源A" },
      { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://b.com/1", sourceId: 2, sourceName: "源B" },
      { title: "球状闪电", author: "刘慈欣", coverUrl: "", bookUrl: "https://a.com/2", sourceId: 1, sourceName: "源A" },
    ];
    const grouped = groupSearchHits(hits);
    expect(grouped.length).toBe(2);
    expect(grouped[0].sources.length).toBe(2);
    expect(grouped[1].title).toBe("球状闪电");
  });
});

describe("toChannelCards", () => {
  it("builds cards with icon, count and representative", () => {
    const cards = toChannelCards([{ group: "📒 小说", sources: [{ id: 1, name: "源A" }, { id: 2, name: "源B" }] }]);
    expect(cards[0].icon).toBe("📒");
    expect(cards[0].count).toBe(2);
    expect(cards[0].representative).toBe("源A");
  });
});
```

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run src/pages/DiscoverPage.test.tsx src/App.test.tsx`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/pages/DiscoverPage.test.tsx
git commit -m "test: 发现页频道卡片与结果聚合测试"
```

---

### Task 5: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] toChannelCards / groupSearchHits 聚合函数 + 测试 ✓
- [ ] 频道卡片网格渲染 ✓
- [ ] 搜索结果聚合 + 来源列表 ✓
- [ ] 空态/加载态 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 发现页重设计终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 发现页重设计终审修复"
```

---
