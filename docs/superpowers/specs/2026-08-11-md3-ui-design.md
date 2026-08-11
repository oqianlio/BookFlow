# 「枕书」MD3 界面重构设计文档

日期：2026-08-11
状态：已批准
前置：全部 6 个书源兼容子项目已完成；本子项目为界面层重构，不改变功能逻辑。

## 1. 目标

将「枕书」界面重构为参照 legado 3.0（Material Design 3）的视觉与导航风格：
- 导航结构照搬 legado 5 个主目的地（首页/书架/发现/RSS/我的），RSS 为占位。
- 视觉采用 MD3 风格，内置多套可切换配色方案。
- 桌面端用侧边导航栏（WideNavigationRail 风格）而非手机底部栏。
- 阅读页保持纸张阅读体验，不跟随应用主题。

## 2. 非目标

- 不实现 RSS 功能（仅占位）。
- 不改动任何书源规则引擎、数据层、阅读逻辑。
- 不新增后端命令（统计全部用现有字段）。
- 不引入路由库（继续用 React 状态导航）。

## 3. 架构

### 3.1 导航状态模型

```
type AppArea = "home" | "bookshelf" | "discover" | "rss" | "my";
type AppState =
  | { area: AppArea }
  | { area: "detail"; page: "reader" | "sourceBook" | "sourceReader" | "explore" | "debug";
      ...载荷 }
```

- 5 个主区 Tab 在侧边栏切换。
- 详情视图（阅读页/书源书页/书源阅读页/探索页/调试器）全屏覆盖，不带侧边栏，顶部返回，返回时回到所属 area。
- App.tsx 由 `useState<View>` 重构为 `useState<AppState>`。

### 3.2 外壳布局

```
┌─────────┬──────────────────────────────┐
│ 侧边栏   │  主区（5 个 Tab 之一）          │
│ ──────  │                              │
│ 🏠 首页  │   内容区（限宽居中，MD3 卡片）   │
│ 📚 书架  │                              │
│ 🔍 发现  │                              │
│ 📰 RSS  │                              │
│ ⚙️ 我的  │                              │
└─────────┴──────────────────────────────┘
```

- 侧边栏固定宽度约 96px，图标+文字纵向排列，选中项用 secondaryContainer 胶囊高亮。
- 主区内容限宽居中（约 980px），背景 --surface，卡片区用 MD3 surface-container 层级。
- RSS Tab 占位空页，禁用态提示。

## 4. 主题系统

### 4.1 配色矩阵

`theme.ts` 重构为「配色方案 × 明暗」：

```
type ThemeScheme = "sora" | "koharu" | "yuuka" | "phoebe" | "wh";
type Theme = { scheme: ThemeScheme; mode: "light" | "dark" };
```

- 持久化格式：settings 表 "theme" = "sora:light"。
- 兼容旧值：若读到的值不含 ":"（如旧 "light"），按默认方案 sora + 该模式解析。
- 现有调用方 getTheme/setTheme/applyTheme/initTheme 的签名保持兼容（返回/接受 Theme 对象）。

### 4.2 Token 映射

现有暖纸墨色 CSS 变量改名为 MD3 语义（或新增并行变量），组件使用 MD3 语义变量：

| 现用 | 替换为 |
|---|---|
| --bg | --surface |
| --surface | --surface-container-lowest |
| --surface-2 | --surface-container-high |
| --fg | --on-surface |
| --fg-muted | --on-surface-variant |
| --accent | --primary |
| --accent-hover | --primary 高亮态 |
| --accent-soft | --secondary-container |
| --border | --outline-variant |
| --border-strong | --outline |
| --danger | --error |

新增层级：--surface-container、--surface-container-low、--surface-dim、--on-primary、--on-primary-container、--on-secondary-container 等。

### 4.3 5 套配色

从 legado `colorScheme/` 目录提取 hex（light+dark 各一份）：

| 方案 | 主色(light) | 气质 |
|---|---|---|
| sora | 青蓝 | legado 默认 |
| koharu | 樱粉 | 柔和 |
| yuuka | 紫 | 梦幻 |
| phoebe | 橙金 | 温暖 |
| wh | 灰 | 极简 |

每套方案定义完整 token 集（primary/secondary/tertiary/surface 各层级/outline/error + 各自 on- 变体）。

### 4.4 组件样式适配

- 卡片：surface-container-lowest + 圆角 12px + MD3 阴影。
- 按钮：filled / text / tonal 三态。
- 分段控件：tonal 高亮。
- 侧边栏选中胶囊：secondary-container。
- 全局 body 背景 --surface，字体保持现有 --font-ui。

## 5. 页面改造

### 5.1 首页（新）

- 顶部问候「你好，枕书」。
- 左侧统计卡：书总数、格式分布（EPUB/PDF/MD/TXT 各数）、最近 7 天打开数。数据源全部来自 `listBooks()`（last_opened_at 统计），无新后端。
- 右侧最近阅读：按 last_opened_at 降序取前 6，复用 BookCard（封面+标题）。
- 快捷入口：导入书籍 / 全文搜索按钮。
- 空态：引导文案 + 导入按钮。
- 点击书籍 → 打开全屏阅读页。

### 5.2 书架

- 现有功能保留（导入/删除/搜索/卡片网格）。
- 去掉顶部「返回书架」类导航按钮（侧边栏承担导航）。
- 卡片网格套 MD3 卡片样式。

### 5.3 发现

- 现有书源搜索 + 探索入口保留，套 MD3 样式。

### 5.4 RSS

- 占位页，提示「敬请期待」。

### 5.5 我的（设置中心，单列列表）

- 将现有 SettingsPage 重构为「我的」页，单列 MD3 list-item 设置组：
  - 主题设置：配色方案（5 选 1 分段）+ 明暗切换。
  - 阅读设置：字号、语速（沿用现有）。
  - 书源管理：BookSourceManager，含「调试」按钮入口 → 全屏调试器页。
  - 关于：版本信息。
- 移除「返回书架」按钮。
- 阅读设置/书源管理/调试等分组以 list item 展开或跳转。

### 5.6 详情页

- 阅读页（本地）：保持纸张主题，不动。
- 书源阅读页：工具栏控件套 MD3 样式，正文区保持纸张风。
- 探索页/书源书页/调试器：套 MD3 样式，全屏覆盖。

## 6. 错误处理

- 首页统计/最近阅读加载失败：显示错误提示 + 重试。
- 主题切换失败：回退到上一主题，控制台提示。
- 各页沿用现有错误模式。

## 7. 测试

- 主题矩阵：5 方案 × 明暗 token 生成单元测试。
- 首页统计逻辑：排序/统计纯函数测试。
- 导航：App shell 切换 area 的组件测试（书架↔我的↔首页）。
- 现有测试全部保持绿。

## 8. 文件清单

- 改：src/App.tsx（AppState 导航 + Shell）
- 改：src/components/theme.ts（配色矩阵）
- 改：src/App.css（MD3 token 替换 + 侧边栏/卡片/按钮/列表样式）
- 改：src/pages/SettingsPage.tsx（→ 我的页单列设置）
- 新：src/pages/HomePage.tsx（统计 + 最近阅读）
- 新：src/components/SideNav.tsx（侧边栏）
- 新：src/pages/RssPage.tsx（占位）
- 改：各页面套 MD3 样式类
- 新：src/components/theme.test.ts 扩充、src/pages/HomePage.test.tsx、App shell 测试
