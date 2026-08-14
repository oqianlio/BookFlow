# 书源合集导入（确认列表）设计文档

日期：2026-08-13
状态：已批准
前置：已完成书源导入（文件/网址）、书源管理、书源规则引擎（含 JS）、MD3 界面。

## 1. 目标

支持导入书源**合集**（JSON 数组，如 `https://www.yckceo.com/yuedu/shuyuans/json/id/1212.json` 含 18 个书源）。当前 `extractBookSourceFromText` 只解析并返回第一个书源，合集只能导入第一个。新功能：解析整个数组，导入前展示书源列表供确认（默认全选、可勾选），确认后批量导入。

## 2. 非目标

- 不做书源预览/试读。
- 不做合集分页（18 个以内直接全量展示）。
- 不改后端存储结构（继续单条 book_sources 记录）。

## 3. 架构

```
importBookSourceFromUrl / importBookSourceFromFile
  └─ parseBookSourceCollection(text) → BookSource[]     # 数组/单对象统一为数组
  └─ 返回 { bookSources: BookSource[] }

BookSourceManager（前端）
  导入返回 bookSources.length > 1 → 展示确认面板：
    - 每行：书名 + URL + 「含脚本」标记（sourceUsesJs）+ 勾选框
    - 默认全选；底部「导入 N 个」按钮
    - 确认 → 批量 commitBookSource + 去重（跳过已存在 URL）
    - 完成 → 刷新列表，显示「成功导入 N 个，跳过 M 个」
  bookSources.length === 1 → 保持现有单书源导入（含 JS 确认框）
```

### 3.1 解析层（bookSourceImport.ts）

- 新增 `parseBookSourceCollection(text: string): any[]`：
  - `JSON.parse(text.trim())` → 若为数组，过滤出每个含 `bookSourceUrl`+`bookSourceName` 的对象；若为单对象 → `[obj]`；非法 → 抛错。
  - 保留现有 `extractBookSourceFromText` 的 `<pre>`/内联正则兜底（网页导入场景），但改为返回数组。
- `importBookSourceFromUrl` / `importBookSourceFromFile` 返回 `{ bookSources: BookSource[] }`。

### 3.2 前端（BookSourceManager.tsx）

- 新增 state：
  ```ts
  const [pendingSources, setPendingSources] = useState<BookSource[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importMsg, setImportMsg] = useState<string | null>(null);
  ```
- `handleFileImport` / `handleUrlImport` 改为接收 `bookSources` 数组：
  - `length === 1` → 现有逻辑（JS 确认弹框 + commit）。
  - `length > 1` → `setPendingSources(bookSources)`，`setSelected(全选)`，显示确认面板。
- 确认面板（渲染在 BookSourceManager 内，复用 MD3 样式）：
  - 列表：每行 `checkbox` + 书名 + URL + （`sourceUsesJs` 时）「含脚本」标记 + 提示「勾选即视为接受脚本」。
  - 底部按钮「导入选中 N 个」→ 批量提交。
- 批量提交：
  ```ts
  const existing = (await listBookSources()).map((s) => s.url);
  let added = 0, skipped = 0;
  for (const bs of [...selected]) {
    if (existing.includes(bs.bookSourceUrl)) { skipped++; continue; }
    await commitBookSource(bs); added++;
  }
  setImportMsg(`成功导入 ${added} 个，跳过 ${skipped} 个`);
  setPendingSources(null); await refresh();
  ```

### 3.3 去重

- 前端提交前用 `listBookSources()` 已有 URL 集合，跳过重复（同 `bookSourceUrl`）。
- 后端 `add_source` 无 UNIQUE 约束，不重复插入靠前端去重。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/bookSourceImport.ts` | 解析层返回数组；新增 parseBookSourceCollection |
| `src/components/BookSourceManager.tsx` | 确认面板 + 批量导入 + 去重 |
| `src/App.css` | 确认面板样式 `.import-confirm-*` |
| `src/services/bookSourceImport.test.ts` | 新增测试（若无测试文件则新建） |

## 5. 测试

- `parseBookSourceCollection`：JSON 数组（多书源）、单对象、非法 JSON 抛错。
- `extractBookSourceFromText`：单对象、数组、`<pre>` 包裹数组。
- BookSourceManager 合集流程：显示列表、默认全选、取消勾选、确认后提交选中数量、去重跳过已存在。

## 6. 错误处理

- JSON 非法 / 无有效书源 → 抛错，界面显示错误提示（现有 error 态）。
- 单个书源提交失败 → 记录到跳过计数，不中断整个批量。
- 合集含 JS 书源 → 列表标记，勾选即接受，不逐个弹框。
