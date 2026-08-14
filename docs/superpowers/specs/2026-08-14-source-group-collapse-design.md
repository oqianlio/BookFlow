# 书源管理按分组折叠设计文档

日期：2026-08-14
状态：已批准
前置：已完成书源导入、书源管理、MD3 界面、UI 动效优化。

## 1. 目标

优化书源管理列表（BookSourceManager）：当前 22 个书源在单列表纵向平铺，一大片拥挤。参考 legado 做法（`BookSourceScreen.kt` 的 `groupByDomain` + 组标题），改为**按 `bookSourceGroup` 分组折叠**：每组一个可点击的组标题行（默认展开），组内书源可展开/收起；空/缺省分组归「未分组」。

## 2. 非目标

- 不改探索页分类（用户明确保留）。
- 不做拖拽排序、多选批量、导入导出（legado 有但本次不做）。
- 不改书源编辑（无独立编辑页）。

## 3. 架构

```
书源
[搜索过滤框]（可选，过滤书源名称/URL）
▼ 未分组 (9)          ← 组标题：primary 色，可点击折叠
  ☑ 番茄小说聚合API
  ☑ 可乐小说 ...
▼ r (7)
  ☑ ...
▼ 同人 (1)
[从文件导入] [网址导入...]
```

### 3.1 分组逻辑（BookSourceManager.tsx）

- 新增 state：`collapsed: Set<string>`（已折叠的组名集合）。
- 从每个 `s.json` 提取分组名：`JSON.parse(s.json).bookSourceGroup`（try/catch，失败归「未分组」）。
- 分组函数：
  ```ts
  function groupSources(sources: BookSource[]): Array<{ group: string; items: BookSource[] }> {
    const map = new Map<string, BookSource[]>();
    for (const s of sources) {
      let g = "未分组";
      try { g = JSON.parse(s.json).bookSourceGroup || "未分组"; } catch { /* keep 未分组 */ }
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()].map(([group, items]) => ({ group, items }));
  }
  ```
- 渲染：`groupSources(sources).map(({ group, items }) => ...)`：
  - 组标题行（`.source-group-head`）：`▼/▶` 箭头 + 组名 + 数量；`onClick` 切换 `collapsed`。
  - 组折叠时：不渲染该组 items；展开时渲染组内 `.source-list` 项（现有行结构保留）。

### 3.2 搜索过滤（可选，参考 legado SearchBar）

- 新增 state：`query: string`。
- 过滤：`sources.filter((s) => s.name.includes(query) || s.url.includes(query))`（大小写不敏感）。
- 顶部搜索框（`.source-filter input`）。
- 过滤后分组（先过滤再分组）。

### 3.3 样式（App.css）

```css
.source-group-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 6px; cursor: pointer; user-select: none;
  font-size: 13px; font-weight: 600; color: var(--primary);
  border-radius: var(--radius-sm);
  transition: background-color 0.18s ease;
}
.source-group-head:hover { background: var(--surface-container-high); }
.source-group-head .caret { width: 16px; flex-shrink: 0; color: var(--on-surface-variant); transition: transform 0.18s ease; }
.source-group-head .caret.open { transform: rotate(90deg); }
.source-group-head .count { margin-left: auto; font-size: 11.5px; color: var(--on-surface-variant); font-weight: 500; }
.source-filter { width: 100%; padding: 9px 14px; margin-bottom: 10px; border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); background: var(--surface-container-low); color: var(--on-surface); font-size: 13px; }
.source-filter:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--secondary-container); }
```

组内列表沿用现有 `.source-list` / `.source-list li`（间距已放宽）。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/components/BookSourceManager.tsx` | 分组折叠 + 搜索过滤 state/逻辑/渲染 |
| `src/components/BookSourceManager.test.tsx` | 分组折叠测试 |
| `src/App.css` | `.source-group-head`/`.caret`/`.count`/`.source-filter` 样式 |

## 5. 测试

- 分组：同组书源聚合、空组归「未分组」、顺序稳定。
- 折叠：点组标题折叠后组内书源隐藏、再点展开。
- 搜索：输入过滤名称/URL 命中。
- 现有导入/去重/调试测试保持绿。

## 6. 错误处理

- `s.json` 解析失败 → 归「未分组」，不抛错。
- 搜索无结果 → 显示空提示（`暂无书源` 或「无匹配书源」）。
