# UI/UX 全面升级设计规格

日期：2026-08-17
参考：Legado 3.0（开源阅读）
状态：待审批

## 目标

以 Legado 3.0 为参照，全面升级枕书的 UI/UX：视觉精细化 → 交互反馈 → 动画升级 → 阅读设置 → 布局优化。

## 约束

- 纯 CSS/React 改动，不引入 UI 框架
- 保留现有 MD3 设计令牌体系
- 兼容 `prefers-reduced-motion`
- 不破坏现有测试（或同步更新）

---

## 第一阶段：视觉精细化

### 1.1 阴影层次（MD3 Elevation）

当前 `shadow-sm/md/lg` 三级已有但层次偏平。增强对比度：

| 层级 | 用途 | 目标值 |
|------|------|--------|
| `--shadow-xs` | 微浮起（chip、badge） | `0 1px 1px rgba(0,0,0,0.05)` |
| `--shadow-sm` | 默认卡片 | `0 1px 3px rgba(0,0,0,0.08)` |
| `--shadow-md` | 悬浮面板 | `0 4px 12px rgba(0,0,0,0.1)` |
| `--shadow-lg` | 对话框/弹窗 | `0 12px 32px rgba(0,0,0,0.14)` |
| `--shadow-xl` | 顶层覆盖 | `0 20px 48px rgba(0,0,0,0.18)` |

暗色模式阴影需独立调参（`html[data-mode="dark"]`），当前已覆盖，微调数值即可。

### 1.2 圆角统一

当前 `radius-sm: 8px / radius-md: 14px / radius-lg: 22px` 体系合理，补充：
- `--radius-xs: 4px` — 小型控件（tag、badge）
- `--radius-full: 999px` — 已有用法，显式声明

### 1.3 间距网格

建立 4px 基准体系：
- `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`

替换现有硬编码 padding/margin 为变量引用。

### 1.4 排版层次

- 补充 `--font-ui-size-xs: 11px`, `--font-ui-size-sm: 12px`, `--font-ui-size-md: 13.5px`, `--font-ui-size-lg: 15px`, `--font-ui-size-xl: 18px`
- 行高统一为 `1.5`（UI 文本）和 `1.8-2.0`（阅读正文）

### 1.5 颜色微调

- `--outline-variant` 对比度偏低，亮色模式加深至 `#bfc2cb`
- 暗色模式 `--surface-container-*` 层级间差值增大 2-3% 以增强层次感

---

## 第二阶段：交互反馈

### 2.1 按钮涟漪效果

为 `.btn`, `.btn-icon`, `.side-nav-item` 添加 CSS ripple 伪元素：
- 点击时在按钮内部产生径向扩散动画
- 用 `::after` 伪元素 + `radial-gradient` 实现
- 时长 300ms，ease-out

### 2.2 卡片悬停态增强

`.book-card:hover` 当前已有 `translateY(-4px) + shadow-md`，增强：
- 添加微妙的光泽渐变（`linear-gradient` 叠加）
- hover 时封面图片轻微放大（已有 `scale(1.045)`，保留）
- 标题区域文字颜色微变

### 2.3 焦点环升级

当前 `:focus-visible` 为简单 outline，升级为 MD3 风格：
- 双层效果：内层 2px `var(--primary)` + 外层 2px `var(--surface)` 间隔
- 对暗色模式自动适配

### 2.4 输入框交互

- `:focus` 时边框颜色渐变 + 底部标签上浮动效
- placeholder 文本在 focus 时淡出

### 2.5 状态反馈

- 加载状态：按钮内 spinner + 文字变灰
- 成功状态：Toast 提示（当前缺失，新增 `Toast` 组件）
- 空状态：已有 `.empty` 样式，增加微妙浮动动画

---

## 第三阶段：动画升级

### 3.1 页面切换过渡

当前 `.app-main > * { animation: page-in }` 为基础 fadeIn。升级为：
- 从侧边滑入 + 淡入组合（`translateX(12px) → 0, opacity 0 → 1`）
- 时长 220ms，cubic-bezier(0.2, 0, 0, 1)
- 不同区域可用差异化方向（书架从左，设置从右）

### 3.2 面板抽屉动画

当前 `.panel` 为 `translateX(24px)` + `opacity`。升级为：
- 弹性缓动：cubic-bezier(0.34, 1.56, 0.64, 1)
- 配合遮罩层淡入

### 3.3 列表 Staggered 入场

书架网格 `.book-card` 逐个入场：
- 使用 CSS `animation-delay` 按索引递增（`calc(var(--i) * 30ms)`）
- 从下方 12px 滑入 + 淡入
- 首次加载和切换分组时触发

### 3.4 对话框动画

当前 `.error-dialog { animation: dialog-in }` 已有。统一增强：
- 遮罩层 `opacity 0 → 0.45`（200ms）
- 对话框 `scale(0.95) → scale(1)` + `opacity 0 → 1`（240ms spring）
- 退出反向动画

### 3.5 微交互

- 侧边栏切换项：图标缩放 + 背景色渐变（已有，微调时长）
- 主题切换：全局颜色过渡 400ms（当前 250ms，加长）
- 分组 chip 切换：滑动指示器效果

---

## 第四阶段：阅读设置完善

### 4.1 翻页模式

当前支持 `cover`（覆盖）和 `slide`（滑动）。新增：
- `scroll`：连续滚动模式（TXT/MD 适用）
- 设置面板增加翻页模式图标选择器

### 4.2 背景主题扩展

当前 4 个预设（纸白/纸黄/护眼绿/夜间）。新增：
- 暖灰 `#e8e4de`
- 淡蓝 `#dce8f0`
- 粉彩 `#f0e4e8`
- 纯黑 `#000000`（OLED 省电）

### 4.3 排版设置补充

当前已有字号/行距/字距/段距/缩进/加粗/字体。新增：
- **文字对齐**：左对齐 / 两端对齐切换
- **页边距**：窄/中/宽三档（`16px / 28px / 40px`）
- **段首缩进**：已有 `indentEm`，确保 UI 可见调节

### 4.4 阅读进度可视化

底部栏增加：
- 章节进度条（百分比 + 拖动跳转）
- 总进度（本章 / 总章节数）

---

## 第五阶段：布局优化

### 5.1 侧边栏折叠

当前 96px 固定宽度。新增：
- 折叠态：48px 宽度，仅显示图标
- 展开态：96px，图标 + 文字
- 折叠/展开按钮 + 持久化状态

### 5.2 设置页重构

当前设置页为线性排列 `settings-group`。重构为：
- 分组卡片式布局（Legado 风格）
- 每组一个卡片，标题 + 内容
- 组间间距 24px
- 卡片内使用紧凑行布局

### 5.3 书架视图扩展

当前支持网格 + 列表。新增：
- **紧凑网格**：更小的卡片 + 隐藏元信息
- **详情列表**：左侧封面 + 右侧进度/作者/简介

### 5.4 响应式优化

- `< 720px`：侧边栏自动折叠，书架 3 列
- `720-1080px`：侧边栏展开，书架 4-5 列
- `> 1080px`：最大宽度限制解除，内容区自适应

---

## 实施优先级

| 阶段 | 文件改动量 | 影响面 | 风险 |
|------|-----------|--------|------|
| 一：视觉精细化 | App.css 为主 | 全局 | 低 |
| 二：交互反馈 | App.css + 少量组件 | 全局 | 低 |
| 三：动画升级 | App.css 为主 | 全局 | 低 |
| 四：阅读设置 | readingSettings.ts + ReaderPage | 阅读器 | 中 |
| 五：布局优化 | App.css + SideNav + SettingsPage + LibraryPage | 全局 | 中 |

阶段 1-3 可连续实施（均为 CSS 改动），阶段 4-5 需分别验证。
