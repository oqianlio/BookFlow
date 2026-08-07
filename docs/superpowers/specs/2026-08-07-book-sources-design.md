# 书源支持（兼容 legado 规则）设计文档

日期：2026-08-07
状态：待审阅

## 1. 产品定位

为「阅卷」桌面阅读器增加**网页抓取规则书源**能力：用户可添加兼容 legado/阅读 App 格式的书源规则，从网上书库实时搜索、浏览目录、在线阅读章节，无需下载文件到本地。

## 2. 非目标

- 不支持音频书源（legado `bookSourceType: 1`）
- 不做整本离线下载（在线实时抓取）
- 不保证书源永久可用——规则由用户/社区维护，网站改版可能导致失效
- 不实现书源社区/远程书源同步

## 3. 技术架构

```
Rust 后端                             WebView 前端（规则引擎）
┌──────────────────┐   http_get      ┌──────────────────────────────┐
│ reqwest 网络层    │ ─────────────► │ 书源规则引擎                   │
│ · 自定义 Header/  │  HTML 字符串     │ · 表达式解析（CSS/XPath/JS/正则）│
│   Cookie/UA       │                │ · 搜索/目录/正文提取            │
│ · 编码解码(GBK等)  │ ◄───────────── │ · 净化与下一章                │
│ · 超时/重试        │  结构化 JSON    │ └──────────────────────────────┘
└──────────────────┘
```

- Rust 侧只做网络与编码：`http_get(url, options) -> String`，用 `reqwest`，`encoding_rs` 解码。
- 前端在 WebView 内实现完整规则引擎：CSS 选择器用 `querySelector`，XPath 用 `document.evaluate`，`@js:` 用 `eval`，正则原生支持。
- 抓取结果（书列表、目录、正文）通过 IPC 返回 Rust 侧存储或直接在前端展示。

## 4. 书源数据模型（兼容 legado JSON）

存储一份完整书源 JSON（`book_source_json` 字段），运行时解析：

```jsonc
{
  "bookSourceUrl": "https://example.com",
  "bookSourceName": "示例书源",
  "bookSourceType": 0,
  "enabled": true,
  "httpUserAgent": "Mozilla/5.0 ...",
  "httpHeaders": { "Cookie": "..." },
  "searchUrl": "https://ex.com/search?q={{key}}",
  "bookUrlPattern": "正则表达式",
  "ruleSearch": {
    "bookList": "CSS/正则", "name": "...", "author": "...",
    "coverUrl": "...", "bookUrl": "..."
  },
  "ruleBookInfo": {
    "init": "", "name": "", "author": "", "intro": "",
    "coverUrl": "", "tocUrl": ""
  },
  "ruleToc": {
    "chapterList": "...", "chapterName": "...", "chapterUrl": "...",
    "nextTocUrl": ""
  },
  "ruleContent": { "content": "...", "nextContentUrl": "" }
}
```

## 5. 规则引擎（尽量兼容 legado 核心）

前端 `src/services/bookSourceEngine.ts` 实现，支持以下表达式语法：

- **CSS 选择器**：`ruleBookInfo.name` 等字段直接写 CSS 选择器或选择器前缀。
- **正则提取**：`{{正则}}` 提取分组，`{{.*?}}` 惰性匹配。
- **正则替换**：`##要替换##替换为##`。
- **JS 表达式**：`@js:` 前缀，在 WebView 内 `new Function` 执行；提供 `java`（模拟 legado 的 `java` 接口，含 `base64`、`regex` 等常用方法）与 DOM 节点参数。
- **节点取值**：legado 常用 `text`/`href`/`src`/`ownText`/`all` 属性后缀（如 `@css:li>a@text`）。
- **XPath**：`@xpath:` 前缀。
- **URL 拼接**：相对路径转绝对 URL（基于 `bookSourceUrl` 或当前页 URL）。
- **下一章/下一页**：`nextTocUrl`、`nextContentUrl` 支持 `{{chapterUrl}}`、`{{page}}` 变量。

### 支持的规则字段

| 阶段 | 字段 |
|---|---|
| 搜索 | `searchUrl`, `ruleSearch.bookList/name/author/coverUrl/bookUrl` |
| 书籍信息 | `ruleBookInfo.init/name/author/intro/coverUrl/tocUrl` |
| 目录 | `ruleToc.chapterList/chapterName/chapterUrl/nextTocUrl` |
| 正文 | `ruleContent.content/nextContentUrl` |
| 全局 | `bookUrlPattern`（校验 URL 匹配）、`httpUserAgent`、`httpHeaders` |

## 6. 抓取流程

```
搜索/发现入口（前端）
  → 取所有 enabled 书源 → 前端规则引擎
  → 依次 http_get(searchUrl 填充 {{key}})
  → 用 ruleSearch 提取书列表 → 合并展示（书名/作者/封面/书源名）

打开书籍
  → 用 ruleBookInfo 提取书名/简介/封面 → 展示书籍页
  → 用 ruleToc 抓取目录 → 展示章节列表

阅读章节
  → http_get(chapterUrl)
  → 用 ruleContent.content 提取正文
  → 净化（去广告标签/替换规则）
  → 展示正文；支持 nextContentUrl 下一页/下一章
```

## 7. 数据存储

沿用现有 SQLite，新增表：

```sql
book_sources(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  json TEXT NOT NULL,          -- 整份书源 JSON
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER
);

book_source_progress(
  source_id INTEGER NOT NULL,
  book_url TEXT NOT NULL,      -- 书籍标识
  title TEXT,
  chapter_index INTEGER,       -- 当前章节序号
  chapter_url TEXT,
  chapter_name TEXT,
  percent REAL,                -- 章内阅读进度
  updated_at INTEGER,
  PRIMARY KEY (source_id, book_url)
);
```

阅读进度按 `(source_id, book_url)` 定位，不落本地文件。

## 8. 前端界面

- **设置 → 书源管理**：书源列表（名称/状态/启用开关）、添加（粘贴 JSON / 导入文件）、编辑、删除、导出。
- **书架顶部「发现」**：搜索框 + 结果列表（封面/书名/作者/书源名）+ 目录浏览入口（如书源支持分类页）。
- **书源书籍页**：封面、书名、作者、简介、「开始阅读」「目录」。
- **书源阅读页**：复用现有阅读器框架的工具栏与主题，正文区为纯文本/HTML 渲染；支持目录跳转、上一章/下一章、进度记忆。

## 9. 错误处理

- 网络失败：按书源维度显示「加载失败，请检查网络或书源是否可用」，单个书源失败不影响其他书源结果。
- 规则解析失败：提示「书源规则解析失败」，可查看书源 JSON 定位问题。
- 无结果：搜索无命中时显示空态，建议尝试其他书源或关键词。
- 章节抓取失败：正文区显示错误与「重试」。
- 超时：Rust 侧设置默认超时（如 15s），可被书源 JSON 覆盖。

## 10. 测试

- Rust：`http_get` 编码解码（UTF-8/GBK）、超时处理。
- 前端 Vitest：
  - 规则引擎单元测试：CSS 提取、正则提取/替换、`@js:` 表达式、节点属性取值、相对 URL 拼接。
  - 用固定 HTML 样例（不含真实网络）测搜索/目录/正文提取全流程。
- 手工冒烟：添加一个真实书源，完成搜索→打开→目录→读一章→翻下一章→进度记忆。
- 不引入真实网络依赖到测试套件（用本地 fixture HTML + mock http_get）。

## 11. 实现里程碑（分解）

1. **网络层**：Rust `http_get` 命令（Header/Cookie/UA/编码/超时）+ 测试。
2. **规则引擎核心**：表达式解析（CSS/正则/节点属性/URL 拼接）+ 单元测试。
3. **规则引擎增强**：`@js:` 表达式、XPath、替换规则 + 测试。
4. **数据层**：`book_sources` / `book_source_progress` 表 + CRUD 命令。
5. **书源管理 UI**：设置页列表/增删改/导入导出。
6. **发现与搜索**：书架「发现」入口 + 搜索 + 结果展示。
7. **书源书籍页与目录**：书籍信息 + 目录抓取展示。
8. **书源阅读页**：正文抓取、净化、翻章、进度记忆。
9. **打磨**：错误态、空态、冒烟测试、打包验证。

## 12. 已知限制

- `@js:` 在 WebView 内执行，受 CSP 与沙箱约束；当前 `tauri.conf.json` 的 CSP 为 `script-src 'self'`，会阻止 `eval`/`new Function`。实现时需要对该页面放宽（如书源阅读页允许 `'unsafe-eval'`）或改用其他执行策略，并评估安全影响（书源规则属用户自粘贴的可信内容，风险可控但需明示）。
- 不执行 `@js:` 中无法安全模拟的 legado 特有 Java API（如部分 `snackBar`/`toast`）。
- 正文抓取按章节整页获取；超长章节可能较慢。
- 部分依赖特定登录态的书源需要用户在 `httpHeaders` 中提供 Cookie。
