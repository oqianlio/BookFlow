# 书源管理独立页面设计文档

日期：2026-08-14
状态：已批准
前置：已完成书源管理分组折叠、MD3 界面、错误弹窗、detail 导航模型。

## 1. 目标

将书源管理从「我的」页（SettingsPage）内嵌组件抽离为**全屏独立页面**（detail 导航），「我的」页只留一个入口。解决书源管理占设置页大量空间的问题。

## 2. 非目标

- 不改书源管理内部逻辑（分组折叠/搜索/导入保持）。
- 不做书源编辑页。
- 不新增后端命令。

## 3. 架构

```
「我的」页（SettingsPage）
  └─ 移除内嵌 <BookSourceManager>
  └─ 新增设置组入口：「书源管理」+ 总数（如「书源管理 · 22」）
      点击 → setState({ area: "detail", page: "sourceManager", back: "my" })

SourceManagerPage（改造自 BookSourceManager）
  ├─ 头部：返回按钮 + 「书源管理」标题（复用 .library-header）
  ├─ 搜索框
  ├─ 分组折叠列表（现有逻辑）
  └─ 导入区（文件/网址）
```

### 3.1 导航模型（App.tsx）

`DetailState` 增加：

```ts
| { area: "detail"; page: "sourceManager"; back: AppArea }
```

分支：

```tsx
case "sourceManager":
  return (
    <SourceManagerPage
      onBack={() => go(state.back)}
      onOpenDebug={(id, name) => setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: "my" })}
    />
  );
```

SettingsPage 增加 `onOpenSourceManager?: () => void` prop，入口按钮调用。

### 3.2 BookSourceManager → 页面组件

`src/components/BookSourceManager.tsx`：
- Props 增加 `onBack?: () => void`（保留 `onDebug`）。
- 根渲染从 `<div className="book-source-manager">` 改为页面布局：
  ```tsx
  <div className="source-manager page">
    <header className="library-header">
      <div className="brand"><h1>书源管理</h1></div>
      {onBack && <button className="btn btn-ghost" onClick={onBack}>返回</button>}
    </header>
    {/* 搜索 + 分组列表 + 导入 + 确认面板（现有内容） */}
  </div>
  ```
- 其余逻辑（分组/折叠/搜索/导入/去重）不变。

### 3.3 SettingsPage 入口

- 移除 `import BookSourceManager` 与 `<BookSourceManager onDebug={...} />`。
- 新增设置组：
  ```tsx
  <div className="settings-group">
    <div>
      <div className="label">书源管理</div>
      <div className="hint">管理书源列表，支持分组、导入、调试</div>
    </div>
    {onOpenSourceManager && <button className="btn btn-soft" onClick={onOpenSourceManager}>打开</button>}
  </div>
  ```
- SettingsPage 不再接收 `onOpenDebug`（调试从书源管理页进入）——保留 prop 或移除，以 App.tsx 接线为准。

### 3.4 样式

- `.source-manager.page` 复用 `.page`（限宽居中）。
- 现有 `.book-source-manager` 的 padding/border-top 调整（独立页不再需要 border-top 分隔）：
  ```css
  .source-manager .book-source-manager { max-width: 720px; padding: 8px 0 0; border-top: none; }
  ```
  （保留类名，仅覆盖布局。）

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/components/BookSourceManager.tsx` | 加 onBack + 页面头部，保留逻辑 |
| `src/components/BookSourceManager.test.tsx` | 更新测试（onBack/头部） |
| `src/pages/SettingsPage.tsx` | 移除内嵌，加入口 + onOpenSourceManager |
| `src/App.tsx` | sourceManager detail 分支 |
| `src/App.test.tsx` | 如受影响则更新 |
| `src/App.css` | `.source-manager` 布局覆盖 |

## 5. 测试

- BookSourceManager：onBack 时渲染返回按钮；现有分组/折叠/搜索/导入测试保持。
- SettingsPage：显示「书源管理」入口，点击触发 onOpenSourceManager；不再渲染内嵌列表。
- App：sourceManager detail 进入/返回。

## 6. 错误处理

- 沿用现有错误弹窗。
- 书源加载/导入失败 → showError。
