# 枕书

跨平台桌面阅读器（Tauri 2 + React + TypeScript + SQLite）。

支持 EPUB / PDF / Markdown / TXT，内置书架、标注书签、全文搜索、TTS 朗读、夜间模式；并支持通过 legado（阅读）书源在线搜索与在线阅读。

## 书源

### 获取书源

书源为 legado 格式的 JSON 文本。可在此类站点获取：

- legado 书源分享站点 / 仓库（如 `legado` 相关 GitHub 仓库的 `legado_source` 合集）
- 书源规则文档：`legado` 官方规则说明（CSS / XPath / 正则 / `@js:`）

### 添加书源

1. 打开 **设置 → 书源**。
2. 两种导入方式：
   - **从文件导入**：选择本地 `.json` 书源文件。
   - **从网址导入**：粘贴书源 JSON 的网址（如书源分享站的 `.json` 链接），自动下载并解析。
3. 添加后可对书源启用 / 停用 / 删除。

### 搜索与在线阅读

1. 书架页点击 **发现**，输入书名搜索（会遍历所有已启用书源）。
2. 在结果中点开书籍，进入书籍页查看简介与目录。
3. 点击章节即可在线阅读：正文自动净化（移除 `script`、`style`、广告节点，并应用书源自带的 `purify` 替换规则）、支持上一章 / 下一章、进度记忆；抓取失败可点击 **重试**。

### 已知限制

- 在线阅读需保持联网。
- 规则依赖站点页面结构，网站改版后书源可能失效，需更新书源或等待维护。
- 仅实现 legado 常用规则子集（CSS、XPath、正则、受限 `@js:`），部分高级规则可能不生效。
- 上一章 / 下一章依赖书源提供的 `nextContentUrl` 规则，缺失时下一章不可用。

## 开发

```
npm install
npm run tauri dev
```

## 测试

```
npm test        # 前端 Vitest
cargo test      # Rust 测试
```

## 打包

```
npm run tauri build
```

Windows 构建产物位于 `src-tauri/target/release/bundle/`（MSI 与 NSIS 安装包）。
