# 阅读体验 R22（A5）：字体文件加载

日期：2026-08-15
状态：待批准
前置：A3 字体变量注入、R8 FONT_PRESETS。

## 1. 目标

导入本地字体文件（.ttf/.otf/.woff2），注册为可用的阅读字体；阅读设置字体选择中出现已导入字体项；导入的字体跨会话持久化。

## 2. 设计

### 2.1 后端（Rust）

- 新命令 `copy_font_file(src_path) -> { name, file }`：把用户选择的字体文件复制到 `app_data_dir/fonts/`（带防冲突文件名），返回显示名（去扩展名）与存储文件名。
- 新命令 `list_font_files() -> Vec<{ name, file }>`：列出 fonts/ 目录文件（供前端加载）。
- 新命令 `delete_font_file(file) -> ()`：删除（可选，本批先不做删除 UI，仅列出）。

```rust
#[tauri::command]
pub fn copy_font_file(src: String, state) -> Result<FontFileRow, String> {
    let fonts_dir = state.app_data_dir.join("fonts");
    std::fs::create_dir_all(&fonts_dir)?;
    let stem = Path::new(&src).file_stem()...;  // 显示名
    let dest_name = format!("{}_{}.{}", now_ts, ext);  // 防冲突
    std::fs::copy(&src, fonts_dir.join(&dest_name))?;
    Ok(FontFileRow { name, file: dest_name })
}
```

- `list_font_files`：读 fonts/ 目录，返回 name（文件名去扩展名，可含用户原名？存 name 到 settings？**简化**：显示名 = 文件名去扩展名；重命名不友好但够用）。

### 2.2 前端（字体注册）

- `src/services/fontFiles.ts`（新建）：
  - `loadFontFiles()` → list_font_files
  - `injectFontFaces(files)`：为每个文件插入 `@font-face`（font-family = 文件名，src = `convertFileSrc(fonts_dir_path + file)`）——用 `@tauri-apps/api/core.convertFileSrc` + asset 协议。
  - 启动时注入（main.tsx 或 App 挂载）。
- `FONT_PRESETS` 扩展：阅读设置字体选择加「已导入字体」区（动态）——`resolveFontCss` 对非预设名直接返回该名（已有），所以字体选择中点击导入字体 → `updateSetting({ fontFamily: 文件名 })` 即可生效（resolveFontCss 返回原样）。

### 2.3 设置页「字体文件」分组

- 选择按钮：`open()` 对话框（.ttf/.otf/.woff2）→ `copy_font_file` → 刷新列表 → 注入 font-face。
- 列表显示已导入字体（名称），点击 → 提示已设为阅读字体（或直接设置 fontFamily？**设置页不直接改阅读设置**——阅读设置面板的字体选择已含自定义输入，导入字体名可直接输入。**简化**：设置页仅管理文件列表；阅读设置面板字体选择加「自定义字体名输入」已有，用户输入文件名即可）。

**更顺滑**：设置页导入后自动 `saveReadingSettings({ ...s, fontFamily: 文件名 })` 设为当前阅读字体。

### 2.4 资产访问

- `convertFileSrc(fonts_dir/file)` 需要 `assetProtocol` 允许 fonts 目录（tauri.conf.json `app.security.assetProtocol.scope`）。检查现有配置——若 asset 协议仅限 books，需扩展。

## 3. 非目标

- 不做字体删除 UI（仅列出）。
- 不做字体预览。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src-tauri/src/commands.rs` | copy_font_file/list_font_files |
| `src-tauri/src/lib.rs` | 注册 |
| `src-tauri/tauri.conf.json` | assetProtocol scope 加 fonts |
| `src/services/api.ts` | 封装 |
| `src/services/fontFiles.ts` | 新建：load/inject |
| `src/pages/SettingsPage.tsx` | 字体文件分组 |
| `src/main.tsx` | 启动注入已导入字体 |
| 测试 | api/命令 |

## 5. 测试

- Rust：copy_font_file 复制成功/名称冲突；list_font_files 列出。
- 前端：fontFiles.injectFontFaces 插入 style 标签；SettingsPage 导入流程（mock open/copy）。
- 现有测试保持绿：`npm test`、`cargo test`、`npm run build`。

## 6. 错误处理

- 复制失败 → showError。
- 非字体文件扩展 → 对话框过滤。
- font-face 注入失败 → 忽略（字体不生效但不崩溃）。
