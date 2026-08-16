# 书架增强：分组 / 多选批量操作 / 书单

日期：2026-08-16
状态：待批准
前置：用户选定"书架增强（书架分组、多选批量操作、书单功能）"。
经验引用：lessons 3.1（数据即状态——分组/书单关系持久化到 DB 而非内存）、
3.37（长列表默认折叠）、2.1（文件修改用 write/edit）。

## 1. 目标

参考 Legado 3.0 书架能力，为枕书书架增加：
1. **书架分组**：书架顶部分组 chips（全部 / 默认 / 自定义分组…），书籍可归属多个分组；
   长按/菜单移动到分组；分组管理（新建/重命名/删除）。
2. **多选批量操作**：书架"选择"模式，勾选多本书 → 批量移动到分组 / 批量移除书架。
3. **书单**：独立于分组的命名收藏列表（可含本地书与在线书），支持从书架/详情页加入书单、
   查看书单内容、删除书单。

## 2. 非目标

- 不做书单的社交分享（Legado 在线书单社区）。
- 不做分组拖拽排序（先做基本分组；排序后续）。
- 不改阅读器/书源引擎。

## 3. 数据模型（SQLite，db.rs 扩展）

```sql
CREATE TABLE IF NOT EXISTS shelf_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shelf_group_members (
    group_id INTEGER NOT NULL REFERENCES shelf_groups(id) ON DELETE CASCADE,
    item_kind TEXT NOT NULL,          -- 'local' | 'source'
    item_id INTEGER NOT NULL,         -- books.id | shelf_source_books.id
    added_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, item_kind, item_id)
);
CREATE TABLE IF NOT EXISTS book_lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS book_list_items (
    list_id INTEGER NOT NULL REFERENCES book_lists(id) ON DELETE CASCADE,
    item_kind TEXT NOT NULL,          -- 'local' | 'source'
    item_id INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, item_kind, item_id)
);
```

设计要点：
- `item_kind + item_id` 统一引用本地书（books.id）与在线书架书（shelf_source_books.id），
  与前端 `ShelfItem`（kind: local/source）对齐。
- 多对多（一本书可在多个分组/多个书单）——Legado 书架同款心智模型。

## 4. 后端命令（commands.rs + db.rs + lib.rs）

分组：
- `list_shelf_groups` → Vec<ShelfGroup>（含每组成员数）
- `create_shelf_group(name)` → id
- `rename_shelf_group(id, name)`
- `delete_shelf_group(id)`（级联删成员）
- `set_shelf_group_members(group_id, members: Vec<(kind, id)>)`：全量覆盖式赋值
  （前端先查当前成员再提交 diff；或后端做差异——简单起见后端全量覆盖）
- `list_shelf_group_members(group_id)` → 成员列表（join 本地/在线书表取展示字段）

批量操作：
- `remove_shelf_items(items: Vec<(kind, id)>)`：混合删除本地书 + 在线书架书
  （本地书删除走 remove_book 逻辑，含文件删除？——查看现有 remove_book 是否删文件）

书单：
- `list_book_lists` / `create_book_list(name, description)` / `delete_book_list(id)`
- `add_book_list_item(list_id, kind, item_id)` / `remove_book_list_item(list_id, kind, item_id)`
- `list_book_list_items(list_id)` → 成员展示信息

## 5. 前端（LibraryPage + BookCard + api.ts + 新组件）

### 5.1 分组 chips（LibraryPage 顶部）

- 状态：`groups: ShelfGroup[]`、`activeGroup: number | "all" | "default"`。
- "全部" = 不过滤；"默认" = 无分组归属的书籍（`NOT IN 任何分组`）。
- 分组 chip 点击过滤书架；chips 行可横向滚动，末尾"管理分组"（新建/重命名/删除弹窗）。
- 持久化：DB（命令如上）。

### 5.2 多选批量操作

- 书架 header 加"选择"按钮 → 进入多选模式（卡片左上角出现复选框/长按卡片也可进入）。
- 多选模式底部出现操作条：全选/取消、移动到分组、移除书架、取消。
- 移除走 ConfirmDialog；移动到分组走分组选择弹窗。

### 5.3 卡片菜单

- BookCard 增加"更多"入口（hover/长按显示菜单）：移动到分组、加入书单、移除书架。
- 加入书单 → 书单选择弹窗（新建书单 or 已有书单）。

### 5.4 书单视图

- 书架 header 加"书单"切换（segmented：书架 / 书单）。
- 书单列表视图：书单卡片（名称、描述、书数）；点开 → 该书单的书籍列表（复用书架卡片），
  可移除该书、删除书单。
- 新增书单：弹窗输入名称/描述。

### 5.5 组件拆分

- `GroupChips.tsx`：分组 chips 行 + 管理弹窗。
- `BatchBar.tsx`：多选模式底部操作条。
- `BookListPicker.tsx`：书单选择/新建弹窗。
- `GroupPicker.tsx`：分组选择弹窗。
- 或合并为 `ShelfDialogs.tsx`（小组件多，合并减少文件数）。

## 6. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/db.rs` | 表 + 分组/书单 CRUD + 混合删除 |
| `src-tauri/src/commands.rs` | 命令实现 |
| `src-tauri/src/lib.rs` | 注册命令 |
| `src/services/api.ts` | TS 命令封装 + 类型 |
| `src/pages/LibraryPage.tsx` | 分组过滤 + 多选模式 + 书单视图切换 |
| `src/components/BookCard.tsx` | 多选勾选 + 菜单入口 |
| `src/components/GroupChips.tsx`（新） | 分组 chips + 管理 |
| `src/components/ShelfDialogs.tsx`（新） | 分组/书单选择与新建弹窗 |
| `src/App.css` | 样式（chips/多选/书单视图） |
| 测试 | LibraryPage.test.tsx / 新组件测试 / api mock 更新 |

## 7. 测试计划

- Rust：db 分组/书单 CRUD 单测（独立 temp DB，lessons 3.19）。
- TS：api 命令封装参数正确性；LibraryPage 分组过滤逻辑；多选批量操作流程；
  书单切换/增删；BookCard 菜单。
- 全量 `npm test` + `cargo test` + `npm run build` 干净。

## 8. 错误处理

- 分组名重复 → 前端提示（DB UNIQUE 约束报错转友好信息）。
- 删除分组 → 成员级联删除（不删书）。
- 删除书 → 分组/书单成员级联删除（外键 + 应用层清理）。
- 书单/分组为空 → 空状态文案。

## 9. 实施顺序

1. db.rs 表 + CRUD + Rust 测试
2. commands.rs + lib.rs 注册
3. api.ts 封装
4. GroupChips + LibraryPage 分组过滤
5. 多选批量操作
6. 书单（弹窗 + 视图）
7. 样式 + 测试 + 全量验证
