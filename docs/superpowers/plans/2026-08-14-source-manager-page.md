# 书源管理独立页面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将书源管理从「我的」页内嵌组件抽离为全屏独立页面（detail 导航），「我的」页只留入口。

**Architecture:** `BookSourceManager` 改造为页面组件（加 `onBack` + 头部）；`App.tsx` 增加 `sourceManager` detail 分支；`SettingsPage` 移除内嵌、加入口按钮 + `onOpenSourceManager` prop。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- 不改书源管理内部逻辑（分组折叠/搜索/导入/去重保持）。
- 调试入口从书源管理页进入（`onOpenDebug`），SettingsPage 不再承担。
- 现有测试保持绿：`npm test`（当前 220），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/components/BookSourceManager.tsx` | 加 onBack + 页面头部 | 修改 |
| `src/components/BookSourceManager.test.tsx` | onBack/头部测试 | 修改 |
| `src/pages/SettingsPage.tsx` | 移除内嵌，加入口 + onOpenSourceManager | 修改 |
| `src/App.tsx` | sourceManager detail 分支 | 修改 |
| `src/App.css` | `.source-manager` 布局覆盖 | 修改 |

## 任务依赖

单任务（BookSourceManager 页面化 + SettingsPage 入口 + App 导航一起落地）。

---

### Task 1: 书源管理独立页面

**Files:**
- Modify: `src/components/BookSourceManager.tsx`
- Test: `src/components/BookSourceManager.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `useError`（现有）；`onDebug`（现有）。
- Produces:
  - `BookSourceManager({ onDebug, onBack })` — `onBack?: () => void` 新增。
  - `SettingsPage({ onOpenSourceManager })` — 移除 onOpenDebug，新增 onOpenSourceManager。
  - App `DetailState` 增加 `{ area: "detail"; page: "sourceManager"; back: AppArea }`。

- [ ] **Step 1: 更新测试（先红）**

`BookSourceManager.test.tsx` 追加：

```tsx
it("renders a back button when onBack is provided", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue(sources);
  const onBack = vi.fn();
  render(<BookSourceManager onBack={onBack} />);
  await screen.findByText("示例书源");
  const back = screen.getByRole("button", { name: /返回/ });
  expect(back).toBeInTheDocument();
  await userEvent.click(back);
  expect(onBack).toHaveBeenCalled();
});
```

`SettingsPage.test.tsx` 更新（若有）：渲染「书源管理」入口，点击触发 `onOpenSourceManager`；不再渲染内嵌列表。

```tsx
it("shows a 书源管理 entry that opens the source manager page", async () => {
  const onOpen = vi.fn();
  render(<SettingsPage onOpenSourceManager={onOpen} />);
  expect(await screen.findByText(/书源管理/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /打开/ }));
  expect(onOpen).toHaveBeenCalled();
});
```

注意：若 SettingsPage.test.tsx 现 mock 了 BookSourceManager，需相应调整。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/BookSourceManager.test.tsx src/pages/SettingsPage.test.tsx`
Expected: FAIL（无 onBack/入口）

- [ ] **Step 3: BookSourceManager 页面化**

`src/components/BookSourceManager.tsx`：

```tsx
export default function BookSourceManager({ onDebug, onBack }: {
  onDebug?: (sourceId: number, sourceName: string) => void;
  onBack?: () => void;
}) {
  // ...现有 state 与逻辑不变

  return (
    <div className="source-manager page">
      <header className="library-header">
        <div className="brand"><h1>书源管理</h1></div>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>返回</button>}
      </header>
      <div className="book-source-manager">
        {/* 原 <div className="book-source-manager"> 内的全部内容移入：搜索、分组列表、导入、确认面板 */}
      </div>
    </div>
  );
}
```

即：原根 `<div className="book-source-manager">` 作为页面 body 保留，外面包 `.source-manager.page` + 头部。内部逻辑零改动。

- [ ] **Step 4: SettingsPage 移除内嵌、加入口**

`src/pages/SettingsPage.tsx`：

```tsx
// 移除 import BookSourceManager
export default function SettingsPage({ onOpenSourceManager }: {
  onOpenSourceManager?: () => void;
}) {
  // ...现有主题/字号/语速 state 与逻辑不变

  // 移除 <BookSourceManager onDebug={onOpenDebug} />（在 BookSourceManager 行）
  // 在关于组之前新增入口组：
  <div className="settings-group">
    <div>
      <div className="label">书源管理</div>
      <div className="hint">管理书源列表，支持分组、导入、调试</div>
    </div>
    {onOpenSourceManager && <button className="btn btn-soft" onClick={onOpenSourceManager}>打开</button>}
  </div>
}
```

移除 `onOpenDebug` prop（App.tsx 不再传）。

- [ ] **Step 5: App.tsx 增加 sourceManager 分支**

`DetailState`（line 17-22）追加：

```ts
  | { area: "detail"; page: "sourceManager"; back: AppArea }
```

detail switch（在 `case "debugSource"` 附近）新增：

```tsx
      case "sourceManager":
        return (
          <BookSourceManager
            onBack={() => go(state.back)}
            onOpenDebug={(id, name) => setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: "my" })}
          />
        );
```

import：`import BookSourceManager from "./components/BookSourceManager";`

`SettingsPage` 分支（line 114-116）改传 `onOpenSourceManager`：

```tsx
{state.area === "my" && (
  <SettingsPage onOpenSourceManager={() => setState({ area: "detail", page: "sourceManager", back: "my" })} />
)}
```

（移除 `onOpenDebug`。）

- [ ] **Step 6: 样式（App.css 追加）**

```css
.source-manager .book-source-manager { max-width: 720px; padding: 8px 0 0; border-top: none; }
```

（`.source-manager.page` 复用 `.page` 限宽居中。）

- [ ] **Step 7: 运行测试 + 构建**

Run: `npx vitest run src/components/BookSourceManager.test.tsx src/pages/SettingsPage.test.tsx src/App.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 8: 终审清单**

- [ ] BookSourceManager 有头部 + 返回按钮（onBack 提供时）✓
- [ ] SettingsPage 移除内嵌、显示「书源管理」入口 + onOpenSourceManager ✓
- [ ] App sourceManager detail 分支，调试跳 debugSource（back: my）✓
- [ ] 书源管理内部逻辑（分组/折叠/搜索/导入）未改动 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 书源管理独立页终审修复`）。

- [ ] **Step 9: Commit**

```bash
git add src/components/BookSourceManager.tsx src/components/BookSourceManager.test.tsx src/pages/SettingsPage.tsx src/App.tsx src/App.css
git commit -m "feat: 书源管理独立页面"
```

---
