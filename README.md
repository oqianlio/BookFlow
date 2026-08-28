<div align="center">

<img src="src-tauri/icons/icon.png" width="128" alt="枕书 BookFlow Logo"/>

# 枕书 · BookFlow

**跨平台桌面阅读器** —— 本地书籍 + legado 书源在线阅读 + TTS 朗读 + 全文搜索

[![Release](https://img.shields.io/github/v/release/oqianlio/BookFlow?color=success)](https://github.com/oqianlio/BookFlow/releases/latest)
[![Build](https://github.com/oqianlio/BookFlow/actions/workflows/release.yml/badge.svg)](https://github.com/oqianlio/BookFlow/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/oqianlio/BookFlow/total)](https://github.com/oqianlio/BookFlow/releases)
[![License](https://img.shields.io/github/license/oqianlio/BookFlow)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-critical)

**[⬇️ 下载安装包](https://github.com/oqianlio/BookFlow/releases/latest)** · [✨ 功能](#-功能特性) · [📖 书源](#-书源) · [🛠️ 技术栈](#️-技术栈) · [🗺️ 路线图](#-路线图)

</div>

---

## ✨ 功能特性

- 📚 **多格式本地阅读** —— EPUB / PDF / Markdown / TXT，自动识别编码（含 GBK）
- 🌐 **书源在线阅读** —— 兼容 [legado（阅读）](https://github.com/gedoor/legado) 书源规则，全网书籍一键搜索
- 🔊 **TTS 朗读** —— 三平台原生语音合成，支持 5/10/15/30/60 分钟睡眠定时
- 🔍 **全文搜索** —— 基于 Tantivy 倒排索引，书架内容毫秒级检索
- 🔖 **书架与标注** —— 书架管理、书签、标注、阅读进度记忆
- 🌙 **夜间模式** —— 深浅色主题，支持跟随系统
- 🧹 **正文净化** —— 自动移除广告/脚本节点，应用书源自带 `purify` 替换规则
- 🔎 **搜索增强** —— 按书名/来源排序过滤、搜索历史快速重搜

## 📥 安装

前往 [**Releases 页面**](https://github.com/oqianlio/BookFlow/releases/latest) 下载对应平台的安装包：

| 平台 | 安装包 | 备注 |
|------|--------|------|
| Windows 10/11 | `枕书_x64_zh-CN.msi` 或 `枕书_x64-setup.exe` | 中文安装界面；未签名，首次运行若遇 SmartScreen 提示，点击「仍要运行」 |
| macOS（Apple Silicon） | `枕书_aarch64.dmg` | 首次打开若被 Gatekeeper 拦截：右键 App → 「打开」 |
| macOS（Intel） | `枕书_x64.dmg` | 同上 |
| Linux | `.deb` / `.rpm` / `.AppImage` | TTS 朗读需安装 `espeak`（`sudo apt install espeak`） |

> ⚠️ 在线阅读需保持联网；书源依赖站点页面结构，网站改版后书源可能失效。

## 📖 书源

### 获取书源

书源为 legado 格式的 JSON 文本，可在 legado 书源分享站点 / 仓库（如 `legado` 相关 GitHub 仓库的 `legado_source` 合集）获取，规则文档见 legado 官方说明（CSS / XPath / 正则 / `@js:`）。

### 添加书源

1. 打开 **设置 → 书源**
2. 两种导入方式：
   - **从文件导入**：选择本地 `.json` 书源文件
   - **从网址导入**：粘贴书源 JSON 的网址，自动下载并解析
3. 添加后可对书源启用 / 停用 / 删除

### 搜索与在线阅读

1. 书架页点击 **发现**，输入书名搜索（遍历所有已启用书源）
2. 点开书籍查看简介与目录，点击章节即可在线阅读
3. 正文自动净化；抓取失败可点击 **重试**；阅读进度自动记忆

### 已知限制

- 仅实现 legado 常用规则子集（CSS、XPath、正则、受限 `@js:`），部分高级规则可能不生效
- 上一章 / 下一章依赖书源的 `nextContentUrl` 规则，缺失时不可用

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 框架 | [Tauri 2](https://tauri.app)（Rust 后端 + 系统 WebView） |
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Rust · `reqwest`（书源抓取）· `rusqlite`（SQLite 存储）· `tantivy`（全文检索）· `encoding_rs`（多编码） |
| 书源引擎 | legado 规则子集：CSS / XPath / JSONPath / 正则 / 受限 `@js:`，模块化实现于 `src/services/bookSourceEngine/` |
| 构建 | GitHub Actions 三平台自动构建，tag 触发发布（`.github/workflows/release.yml`） |

## 🗺️ 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| L1 | WebDAV 备份导入：一键把手机 legado 的书源/订阅搬进枕书 | 计划中 |
| L2 | Web 服务客户端：同局域网镜像手机书架，点开即从手机进度续读 | 计划中 |
| L3 | 进度双向同步 | 计划中 |
| L4 | 备份深度恢复（书架/标注） | 计划中 |

## 💻 开发

```bash
npm install          # 安装依赖
npm run tauri dev    # 启动开发环境
npm test             # 前端 Vitest
cargo test           # Rust 测试
npm run tauri build  # 本地打包
```

> Rust 环境与平台依赖参见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)。Linux 构建需 `libwebkit2gtk-4.1-dev` 等系统包。

## 📄 License

[MIT](LICENSE) © 2026 oqianlio
