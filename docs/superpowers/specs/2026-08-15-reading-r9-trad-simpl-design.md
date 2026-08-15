# 复刻 legado 阅读体验 R9：简繁转换

日期：2026-08-15
状态：待批准
前置：R8 排版扩展完成。

## 1. 目标

阅读设置面板新增「简体 / 繁体」切换，书源正文按所选方向做简繁映射，持久化并即时生效。

## 2. 背景与问题

legado 阅读器内置简繁转换（如阅读台版书源时转简体，读简体书源时转繁体）。当前枕书无此能力，正文原样显示。

## 3. 非目标

- 不做智能词组上下文转换（OpenCC 级别的词组表）——本批用**单字映射字典**，覆盖常用字即可。
- 不做本地书（EPUB/PDF 等）的简繁转换（本批聚焦书源正文 + PaginatedReader 路径）。
- 不做目录/标题转换（仅正文）。

## 4. 架构

```
简繁字典（新文件 src/services/tradSimpl.ts）
  toSimplified(text: string): string    // 繁 → 简
  toTraditional(text: string): string   // 简 → 繁
  单字映射（常用字表），非命中原样保留

readingSettings.ts 扩展
  + conversion: "none" | "simp" | "trad"   // 默认 "none"

ReaderPage
  - 设置面板加「简繁」segmented（原样/简体/繁体）
  - 正文渲染前按 settings.conversion 转换：
      content → convert → 传给 PaginatedReader
  - 缓存写入仍存原文（转换是展示层，不改缓存）
```

### 4.1 字典（src/services/tradSimpl.ts）

```ts
export type Conversion = "none" | "simp" | "trad";
export function toSimplified(text: string): string;
export function toTraditional(text: string): string;
export function convertText(text: string, c: Conversion): string;  // none 原样
```

- 单字映射：`SIMP_TO_TRAD: Record<string, string>`（简 → 繁）+ 反向推导 `TRAD_TO_SIMP`。
- 覆盖常用字（几百字核心集：门/开/关/见/说/时/后/发/长/东/车/书/马/鸟/鱼/电/学/国/会/来/过/还/这/样/等等）。
- 转换实现：逐字符查表（`for...of` 处理 Unicode），O(n)。

### 4.2 readingSettings 扩展

- `conversion: Conversion` 字段，默认 `"none"`。
- 存储键 `reading.conversion`，值 "none"/"simp"/"trad"。
- load 校验（非法回退 none）；save 追加。

### 4.3 ReaderPage 接入

- 面板「简繁」组（背景组后）：

```tsx
<div className="settings-group">
  <label className="settings-label">简繁</label>
  <div className="segmented" role="group" aria-label="简繁">
    <button type="button" className={settings.conversion === "none" ? "active" : ""} onClick={() => updateSetting({ conversion: "none" })}>原样</button>
    <button type="button" className={settings.conversion === "simp" ? "active" : ""} onClick={() => updateSetting({ conversion: "simp" })}>简体</button>
    <button type="button" className={settings.conversion === "trad" ? "active" : ""} onClick={() => updateSetting({ conversion: "trad" })}>繁体</button>
  </div>
</div>
```

- 正文传递：PaginatedReader 的 html 用 `convertText(content, settings.conversion)` 包裹：

```tsx
const displayContent = convertText(content, settings.conversion);
<PaginatedReader html={`<p>${displayContent.replace(/\n/g, "</p><p>")}</p>`} ... />
```

- 缓存：saveCachedChapter 存**原文**（未转换），读取缓存后展示时再转换——转换始终发生在渲染前，缓存只存原始正文。**注意**：当前 ReaderPage 缓存路径 `setContent(cached)` 直接渲染，需改为 `setContent(cached)` 后由渲染处统一 convertText（即 cached 存入 state，渲染时转换）。已满足——渲染时统一转换。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/tradSimpl.ts` | 新建：字典 + 转换函数 |
| `src/services/tradSimpl.test.ts` | 新建：简繁/反向/原样测试 |
| `src/services/readingSettings.ts` | conversion 字段 |
| `src/services/readingSettings.test.ts` | conversion 测试 |
| `src/pages/ReaderPage.tsx` | 面板控件 + 渲染转换 |
| `src/pages/ReaderPage.source.test.tsx` | 转换测试 |

## 6. 测试

- tradSimpl：toSimplified 常见繁字转简、toTraditional 反向、非字典字原样、convertText none 原样。
- readingSettings：conversion 默认/加载/非法回退/保存。
- ReaderPage：切换繁体 → 正文显示繁体（mock 字典或真实字典 + 含繁体字正文）、持久化调用。
- 现有测试保持绿：`npm test`、`npm run build`。

## 7. 错误处理

- 字典查找无命中 → 原样保留（天然兜底）。
- conversion 设置非法 → 回退 "none"。
- 转换不改变缓存内容（展示层），无数据风险。
