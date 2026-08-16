# 实施计划：书架增强（分组 / 多选批量 / 书单）

日期：2026-08-16
状态：实施中
前置：spec `2026-08-16-shelf-groups-design.md`。
经验引用：lessons 3.1（分组/书单关系持久化 DB）、3.37（长列表折叠）、2.1（write/edit 改文件）。

## 已完成

1. **Rust 后端**（db.rs + commands.rs + lib.rs）：
   - 表：`shelf_groups` / `shelf_group_members` / `book_lists` / `book_list_items`
     （item_kind + item_id 统一引用本地/在线书，多对多）
   - 分组 CRUD + 成员增删/全量覆盖/查询 + `remove_shelf_items` 混合批量删除（本地书含文件+索引清理）
   - 书单 CRUD + 条目增删/列表查询
   - 命令注册 lib.rs；`friendly_unique_error` 处理分组重名
   - Rust 测试 3 个（分组 CRUD+成员、书单 CRUD+条目、混合删除），cargo test 全绿

2. **TS API**（api.ts）：分组/书单全部命令封装 + 类型

3. **前端**：
   - `GroupChips.tsx`：分组 chips（全部/默认/自定义）+ 管理弹窗 + 分组选择弹窗
   - `BookListPicker.tsx`：加入书单弹窗（已有书单选择 / 新建书单）
   - `BookCard.tsx`：多选模式（复选框+selected 高亮）、更多菜单按钮（⋯）
   - `LibraryPage.tsx`：
     - 书架/书单视图切换 tabs
     - 分组过滤（全部/默认=无分组/指定分组）
     - 多选模式（多选按钮进入，batch bar：全选/移动到分组/加入书单/移除/取消）
     - 卡片菜单（移动到分组/加入书单/移除书架）
     - 书单视图（书单卡片列表、书单详情、删除书单、从书单移除）
   - 图标：GearIcon / PlusIcon / CheckIcon
   - App.css：chips/多选/batch bar/菜单/书单视图样式

4. **测试**（LibraryPage.test.tsx 新增 5 个）：
   - 分组 chips 过滤（组内/默认）
   - 管理弹窗新建分组
   - 多选批量移动到分组
   - 卡片菜单新建书单并加入
   - 多选批量移除（确认后调 removeShelfItems）
   - 原有 11 个用例适配（removeShelfItems 替代 removeShelfSourceBook）

## 验证中

- 全量 vitest（预期 519 + 8 + 5 = 532+）
- tsc --noEmit 干净
- cargo test 全绿（已完成）

## 下一步

1. 全量测试确认后提交（commit: feat: 书架分组/多选批量/书单）。
2. 进入缓存与订阅管理阶段。
