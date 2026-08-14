# 首页仪表盘改造设计文档

日期：2026-08-14
状态：已批准
前置：已完成 MD3 界面、错误弹窗、书源功能、导入等。

## 1. 目标

解决首页「最近阅读」与书架功能重复的问题：首页改为**仪表盘**（统计卡 + 快捷入口），移除书籍卡片网格。统计卡保留（藏书/格式分布/近7天打开），快捷入口为「导入书籍」「去书架」「去发现」三个按钮。全文搜索保留在书架页（其图标按钮），不做跨页状态传递。

## 2. 非目标

- 不在首页显示任何书籍卡片/列表（彻底消除与书架重复）。
- 不实现「全文搜索」跨页快捷（搜索仍从书架进入）。
- 不新增后端命令（统计沿用 `computeStats` + `listBooks()`）。

## 3. 架构

```
首页（仪表盘）
  ├─ 统计卡区：藏书 / 各格式数 / 近7天打开（computeStats）
  ├─ 快捷入口：导入书籍 / 去书架 / 去发现
  └─ 空态：书架空 → 「书架空空如也」+ 去书架按钮
```

### 3.1 HomePage 改造（src/pages/HomePage.tsx）

- **Props 变更**：
  ```ts
  export default function HomePage({
    onOpenBook, onGoBookshelf, onGoDiscover,
  }: {
    onOpenBook: (b: Book) => void;
    onGoBookshelf?: () => void;
    onGoDiscover?: () => void;
  })
  ```
  - `onOpenBook` 保留（未来可能用于统计区点击？当前统计卡纯展示，实际不再使用——**移除**该 prop 引用，除非保留空态跳书）。**决策**：移除 `onOpenBook`（统计卡无点击，空态用 onGoBookshelf）。但 App.tsx 现有传 `onOpenBook`——需同步。为最小改动，保留 prop 声明但不再使用会导致 tsc 未使用参数告警（`noUnusedParameters`? 需确认）。**倾向**：移除 `onOpenBook` prop，App.tsx 同步删除。
- **移除**：`recent` 计算、`<BookCard>` 网格渲染、`BookCard` import。
- **新增**：快捷入口区。
  ```tsx
  <div className="home-quick">
    <button className="btn btn-primary" onClick={handleImport}>导入书籍</button>
    <button className="btn btn-soft" onClick={onGoBookshelf}>去书架</button>
    <button className="btn btn-soft" onClick={onGoDiscover}>去发现</button>
  </div>
  ```
- **导入逻辑**（复用 LibraryPage 模式）：`handleImport` 调 `importFiles()` + 刷新统计。
  ```ts
  import { importFiles, listBooks, type Book } from "../services/api";
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const handleImport = async () => {
    setBusy(true);
    try { await importFiles(); const list = await listBooks(); setBooks(list); }
    catch (e) { showError(String(e)); }
    finally { setBusy(false); }
  };
  ```
- **空态**：`books.length === 0` 时显示「书架空空如也」+ 去书架按钮（保留现有空态结构，去掉 BookIcon 或保留）。

### 3.2 App.tsx 接线

```tsx
{state.area === "home" && (
  <HomePage
    onGoBookshelf={() => setState({ area: "bookshelf" })}
    onGoDiscover={() => setState({ area: "discover" })}
  />
)}
```
（移除 `onOpenBook` 传参。）

### 3.3 样式（App.css）

```css
.home-quick { display: flex; flex-wrap: wrap; gap: 10px; padding: 8px 0 24px; }
.home-stats { /* 保留现有 */ }
```

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/pages/HomePage.tsx` | 改仪表盘：删 BookCard 网格，加快捷入口 + 导入逻辑 |
| `src/App.tsx` | HomePage 接线：删 onOpenBook，加 onGoDiscover |
| `src/App.css` | 加快捷入口样式 |
| `src/pages/HomePage.test.tsx` | 更新测试 |

## 5. 测试

- `computeStats` 纯函数测试保留。
- HomePage：渲染统计卡 + 3 个快捷按钮；点击导入调用 `importFiles`；空态显示「书架空空如也」；去书架/去发现回调触发。
- 移除最近阅读相关断言。
- 现有测试全绿。

## 6. 错误处理

- 导入失败 → `showError`（错误弹窗）。
- 统计加载失败 → `showError`。
