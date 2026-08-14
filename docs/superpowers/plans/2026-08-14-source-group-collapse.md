# 书源管理按分组折叠实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 书源管理列表改为按 `bookSourceGroup` 分组折叠（组标题可展开/收起）+ 顶部搜索过滤，参考 legado 的分组做法。

**Architecture:** `BookSourceManager.tsx` 新增 `collapsed: Set<string>` 与 `query: string` state；`groupSources(sources)` 从 `s.json` 提取分组名聚合；渲染组标题行（箭头+组名+数量）+ 组内列表；搜索先过滤再分组。App.css 加组标题/搜索框样式。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 不改探索页分类。
- 不做拖拽排序/多选批量/导入导出。
- `s.json` 解析失败归「未分组」，不抛错。
- 现有测试保持绿：`npm test`（当前 217），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/components/BookSourceManager.tsx` | 分组折叠 + 搜索过滤 | 修改 |
| `src/components/BookSourceManager.test.tsx` | 分组/折叠/搜索测试 | 修改 |
| `src/App.css` | `.source-group-head`/`.caret`/`.count`/`.source-filter` | 修改 |

## 任务依赖

单任务（分组折叠 + 搜索 + 样式一起落地）。

---

### Task 1: 书源管理分组折叠 + 搜索

**Files:**
- Modify: `src/components/BookSourceManager.tsx`
- Test: `src/components/BookSourceManager.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `BookSource` from `../services/api`；现有 refresh/import/delete/toggle。
- Produces:
  ```ts
  function groupSources(sources: BookSource[]): Array<{ group: string; items: BookSource[] }>;
  ```
  （组件内辅助函数，或导出以便测试——倾向导出。）

- [ ] **Step 1: 写失败测试（追加到 BookSourceManager.test.tsx）**

```tsx
const groupedSources = [
  { id: 1, name: "番茄", url: "https://a.com", json: JSON.stringify({ bookSourceGroup: "r" }), enabled: true, last_used_at: null },
  { id: 2, name: "可乐", url: "https://b.com", json: JSON.stringify({ bookSourceGroup: "r" }), enabled: true, last_used_at: null },
  { id: 3, name: "同人", url: "https://c.com", json: JSON.stringify({ bookSourceGroup: "同人" }), enabled: true, last_used_at: null },
  { id: 4, name: "无组", url: "https://d.com", json: "{}", enabled: true, last_used_at: null },
];

it("groups sources by bookSourceGroup with 未分组 fallback", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
  render(<BookSourceManager />);
  expect(await screen.findByText("r")).toBeInTheDocument();
  expect(screen.getByText("同人")).toBeInTheDocument();
  expect(screen.getByText("未分组")).toBeInTheDocument();
  expect(screen.getByText("番茄")).toBeInTheDocument();
  expect(screen.getByText("无组")).toBeInTheDocument();
});

it("collapses a group on header click and hides its sources", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
  render(<BookSourceManager />);
  await screen.findByText("r");
  await userEvent.click(screen.getByText("r"));
  expect(screen.queryByText("番茄")).not.toBeInTheDocument();
  expect(screen.getByText("同人")).toBeInTheDocument(); // 其他组仍展开
  await userEvent.click(screen.getByText("r"));
  expect(screen.getByText("番茄")).toBeInTheDocument();
});

it("filters sources by name or url via search box", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
  render(<BookSourceManager />);
  await screen.findByText("番茄");
  await userEvent.type(screen.getByLabelText("搜索书源"), "可乐");
  expect(screen.getByText("可乐")).toBeInTheDocument();
  expect(screen.queryByText("番茄")).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("搜索书源"));
  await userEvent.type(screen.getByLabelText("搜索书源"), "https://c.com");
  expect(screen.getByText("同人")).toBeInTheDocument();
});
```

注意：`sources` 常量（line 24）用于现有测试，json 为 `"{}"` → 归「未分组」——现有测试断言 `示例书源` 仍应通过（未分组组内显示）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/BookSourceManager.test.tsx`
Expected: FAIL（无分组/折叠/搜索）

- [ ] **Step 3: 实现 BookSourceManager**

```tsx
// 新增 import 与 state
import { ... } from "react";
// state:
const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
const [query, setQuery] = useState("");

// 分组辅助函数（导出便于测试）
export function groupSources(sources: BookSource[]): Array<{ group: string; items: BookSource[] }> {
  const map = new Map<string, BookSource[]>();
  for (const s of sources) {
    let g = "未分组";
    try {
      const parsed = JSON.parse(s.json);
      g = parsed?.bookSourceGroup || "未分组";
    } catch { /* 归未分组 */ }
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

const toggleGroup = (g: string) => {
  const next = new Set(collapsed);
  if (next.has(g)) next.delete(g); else next.add(g);
  setCollapsed(next);
};
```

渲染部分（替换 line 146-169 的列表）：

```tsx
{sources.length === 0 ? (
  <p className="panel-empty">暂无书源</p>
) : (
  <>
    <input
      className="source-filter"
      aria-label="搜索书源"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="搜索书源名称或网址"
    />
    {groupSources(
      query.trim()
        ? sources.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()) || s.url.toLowerCase().includes(query.trim().toLowerCase()))
        : sources,
    ).map(({ group, items }) => {
      const isCollapsed = collapsed.has(group);
      return (
        <div key={group}>
          <div className="source-group-head" onClick={() => toggleGroup(group)} role="button" aria-expanded={!isCollapsed}>
            <span className={`caret${isCollapsed ? "" : " open"}`}>▶</span>
            <span>{group}</span>
            <span className="count">{items.length}</span>
          </div>
          {!isCollapsed && (
            <ul className="source-list">
              {items.map((s) => (
                <li key={s.id}>
                  <div className="source-info">
                    <span className="source-name">{s.name}</span>
                    <span className="source-url">{s.url}</span>
                  </div>
                  <div className="source-actions">
                    <input
                      type="checkbox"
                      aria-label={`启用 ${s.name}`}
                      checked={s.enabled}
                      onChange={(e) => void handleToggleEnable(s.id, e.target.checked)}
                    />
                    <button className="btn btn-ghost" onClick={() => onDebug?.(s.id, s.name)}>调试</button>
                    <button className="btn btn-ghost" onClick={() => void handleDelete(s.id)}>删除</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    })}
  </>
)}
```

注意：`.source-list` 现有 `margin: 0 0 14px`——多组时组间距由 `margin-bottom` 承担；可微调 `.source-group-head` 的 `padding-top` 分隔。搜索无结果时：`groupSources(filtered)` 为空数组 → 显示 `panel-empty`「无匹配书源」：

```tsx
{groupSources(filtered).length === 0 && <p className="panel-empty">无匹配书源</p>}
```

（为清晰，把过滤结果先算成变量 `filtered`。）

- [ ] **Step 4: 样式（App.css 追加）**

```css
.source-group-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 6px 8px; cursor: pointer; user-select: none;
  font-size: 13px; font-weight: 600; color: var(--primary);
  transition: color 0.18s ease;
}
.source-group-head .caret { width: 14px; flex-shrink: 0; font-size: 11px; color: var(--on-surface-variant); transition: transform 0.18s ease; }
.source-group-head .caret.open { transform: rotate(90deg); }
.source-group-head .count { margin-left: auto; font-size: 11.5px; color: var(--on-surface-variant); font-weight: 500; }
.source-filter { width: 100%; padding: 10px 14px; margin-bottom: 6px; border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); background: var(--surface-container-low); color: var(--on-surface); font-size: 13px; font-family: var(--font-ui); }
.source-filter:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--secondary-container); }
.source-filter::placeholder { color: var(--on-surface-variant); }
```

- [ ] **Step 5: 运行测试 + 构建**

Run: `npx vitest run src/components/BookSourceManager.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 6: 终审清单**

- [ ] 按 bookSourceGroup 分组，空组归「未分组」✓
- [ ] 组标题点击折叠/展开，折叠隐藏组内书源 ✓
- [ ] 搜索按名称/URL 过滤（大小写不敏感）✓
- [ ] 现有导入/去重/调试测试保持绿 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 书源分组终审修复`）。

- [ ] **Step 7: Commit**

```bash
git add src/components/BookSourceManager.tsx src/components/BookSourceManager.test.tsx src/App.css
git commit -m "feat: 书源管理按分组折叠 + 搜索"
```

---
