# 桌面阅读器「阅卷」设计文档

日期：2026-08-06
状态：已批准

## 1. 产品定位

跨平台桌面阅读器，支持 EPUB / PDF / Markdown / TXT 四种格式。内置书架管理、标注与书签、全文搜索、TTS 朗读、个性化主题。目标：资源占用小、启动快、翻页流畅。

## 2. 非目标

- 不提供 OCR 功能
- 不提供在线书城 / 云同步
- 不做 PDF 原生编辑（仅阅读）
- 不提供浏览器类网页阅读

## 3. 技术栈

| 层 | 技术 |
|---|---|
| 桌面外壳 | Tauri 2 |
| 后端 | Rust |
| 前端 | React + TypeScript + Vite |
| EPUB 渲染 | epub.js |
| PDF 渲染 | pdf.js |
| Markdown 渲染 | marked + 自定义样式 |
| 数据库 | SQLite（rusqlite / tauri-plugin-sql） |
| 全文索引 | tantivy |
| TTS | 系统语音：Windows SAPI / macOS AVSpeechSynthesizer / Linux espeak(speech-dispatcher) |

平台：Windows / macOS / Linux。

## 4. 架构

```
┌─────────────────────────────────────────┐
│  Web 前端 (React + TypeScript + Vite)    │
│  epub.js / pdf.js / markdown 渲染         │
│  书架页 / 阅读页 / 设置页                  │
└──────────────▲──────────────────────────┘
        Tauri IPC (invoke/事件)
┌──────────────┴──────────────────────────┐
│  Rust 后端 (Tauri 2)                     │
│  文件导入/复制到应用目录 · SQLite 数据库    │
│  全文索引 (tantivy) · 系统 TTS 调用        │
└─────────────────────────────────────────┘
```

- 前后端通过 Tauri IPC（`invoke` 命令与事件）通信。
- 所有文件操作与数据库访问在 Rust 侧完成，前端只通过命令调用。
- 书籍文件复制到应用数据目录管理，书架元数据存 SQLite。

## 5. 功能模块

### 5.1 书架

- 导入书籍：文件选择器支持 EPUB/PDF/MD/TXT 多选；导入时复制文件到应用数据目录 `books/`。
- 元数据：标题（取文件名或 EPUB 元数据）、格式、封面（EPUB 提取封面图，PDF 渲染首页缩略图，MD/TXT 生成占位封面）。
- 视图：卡片网格，显示封面、标题、阅读进度；按最近阅读排序。
- 操作：打开阅读、删除书籍（连同文件）、重命名。

### 5.2 阅读器

- 按格式分流渲染：
  - EPUB：epub.js 渲染，翻页模式（分页视图），记住 CFI 位置。
  - PDF：pdf.js 渲染，支持缩放、单页/连续滚动，记住页码。
  - MD：marked 渲染为带样式的 HTML。
  - TXT：按段落自动分页，记住页码。
- 阅读进度自动保存：EPUB 用 CFI，PDF/MD/TXT 用页码 + 滚动百分比。
- 快捷键：左右方向键翻页、`Esc` 返回书架、`Ctrl+F` 页内搜索（浏览器内置）、`Ctrl+B` 书签。

### 5.3 标注与书签

- 标注（EPUB）：选中文本 → 高亮（多颜色）+ 可选笔记；存 SQLite，用 CFI 定位。
- 标注（PDF）：选中文本 → 高亮，存页码 + 文本内容，跳转用文本定位。
- 书签：记录当前位置（CFI/页码），可加标签。
- 标注/书签面板：侧边抽屉，点击跳转到对应位置，可删除。

### 5.4 全文搜索

- Rust 侧 tantivy 索引：导入时提取文本（EPUB 解析 HTML 文本，PDF 用 Rust `pdf-extract` crate 提取文本层，MD/TXT 直接读取）。索引文本提取在 Rust 侧完成，与前端 pdf.js 渲染职责分离。
- 搜索范围：书名 + 正文。结果按文档/章节列出，命中片段高亮。
- 点击结果在阅读器中定位跳转（EPUB 通过搜索 CFI，PDF 通过页码，MD/TXT 通过行号）。

### 5.5 TTS 朗读

- 朗读当前选中文本；无选中时朗读当前页/当前章节。
- 后端封装系统语音：Windows SAPI、macOS AVSpeechSynthesizer、Linux espeak。
- 控制：播放 / 暂停 / 停止 / 语速调节（0.5x–2x）。
- 设备不可用或朗读失败时前端给出提示，不崩溃。

### 5.6 个性化

- 字体、字号、行距、页边距设置。
- 白天 / 夜间主题。
- 设置存 SQLite `settings` 表或 Tauri 配置文件，阅读时生效。

## 6. 数据存储

SQLite 位于应用数据目录 `reader.db`，表结构：

```sql
books(id INTEGER PK, title TEXT, format TEXT, path TEXT UNIQUE,
      cover_path TEXT, added_at INTEGER, last_opened_at INTEGER)

reading_progress(book_id INTEGER PK REFERENCES books(id) ON DELETE CASCADE,
                 location TEXT, percent REAL, updated_at INTEGER)

annotations(id INTEGER PK, book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
            format TEXT, location TEXT, text TEXT, note TEXT,
            color TEXT, created_at INTEGER)

bookmarks(id INTEGER PK, book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
          location TEXT, label TEXT, created_at INTEGER)

settings(key TEXT PK, value TEXT)
```

全文索引由 tantivy 写入应用数据目录 `index/`，与书籍同步增删。

## 7. 错误处理

- 损坏 / 无法解析的文件：导入或打开时给出明确错误提示，不崩溃。
- 导入失败：删除已复制的残留文件，回滚记录。
- 索引缺失 / 损坏：检测后自动重建。
- TTS 不可用：前端降级提示。
- 书未找到（文件被外部删除）：书架标记为缺失，提示用户移除或重新导入。

## 8. 测试

- Rust 单元测试：书籍导入、进度读写、索引构建与搜索、标注 CRUD。
- 前端 Vitest：组件测试（书架渲染、搜索框、设置面板状态）。
- 手工冒烟：四种格式打开、翻页、进度恢复、标注跳转、搜索跳转、TTS 播放。

## 9. 交付目录结构（初步）

```
yd/
├─ src/                  # React 前端
│  ├─ pages/             # 书架 / 阅读 / 设置
│  ├─ components/
│  ├─ readers/           # epub / pdf / md / txt 渲染器封装
│  └─ services/          # Tauri invoke 封装
├─ src-tauri/            # Rust 后端
│  ├─ src/
│  │  ├─ commands.rs     # IPC 命令
│  │  ├─ db.rs           # SQLite
│  │  ├─ import.rs       # 书籍导入
│  │  ├─ index.rs        # tantivy 全文索引
│  │  └─ tts.rs          # TTS 后端
│  └─ Cargo.toml
├─ docs/superpowers/specs/
└─ package.json
```

## 10. 里程碑顺序

1. 脚手架：Tauri 2 + React + TS + SQLite 打通
2. 书架：导入 + 列表 + 元数据 + 封面
3. 阅读器：四种格式渲染 + 进度保存/恢复
4. 标注 / 书签
5. 全文搜索
6. TTS 朗读
7. 个性化设置 + 夜间模式
8. 打磨：错误处理、测试、打包
