# 阅卷

跨平台桌面阅读器（Tauri 2 + React + TypeScript + SQLite）。

支持 EPUB / PDF / Markdown / TXT，内置书架、标注书签、全文搜索、TTS 朗读、夜间模式。

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
