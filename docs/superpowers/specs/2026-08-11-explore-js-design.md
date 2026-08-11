# 书源探索分类 `@js:` 支持设计文档

日期：2026-08-11
状态：已批准
前置：已完成 legado 3.0 兼容书源引擎（CSS/XPath/正则/`@js:`/`||`/`tag.x`）、规则变量（sourceVars）、探索页（ruleExplore）、MD3 界面重构。

## 1. 目标

支持书源 `exploreUrl` 以 `@js:` 开头的动态分类生成（legado 兼容），例如 `@js:GEN_EXPLORE()`，其中 `GEN_EXPLORE` 等函数定义在书源的 `jsLib` 字段。当前 `parseExploreUrl` 只做纯文本按行解析，`@js:` 前缀会被当成普通分类名显示。

## 2. 非目标

- 不支持远程 URL 形式的 jsLib（需网络下载 + 缓存，后续子项目再议）。仅支持内联 JS 字符串。
- 不修改搜索/目录/正文的 `@js:` 行为（已支持）。
- 不做探索分类结果的持久化缓存（每次打开书源重新生成）。

## 3. 架构

```
ExplorePage 打开书源
   └─ loadJsLib(sourceKey, s.jsLib)     # 内联 JS 缓存到会话 Map
   └─ parseExploreUrl(s.exploreUrl, { sourceKey, source })
        └─ exploreUrl 以 "@js:" 开头
             └─ evalJs(expr, ctx)        # 先 eval jsLib 代码再 eval 表达式
                  └─ 结果: JSON 数组 [{title|name, url}]
                       或 字符串 "分类::URL" 每行/&& 分隔
             └─ 两种格式统一为 { title, url }[]
```

### 3.1 jsLib 加载（新文件 `src/services/jsLib.ts`）

- 会话级缓存 `Map<sourceKey, string>`（与 `sourceVars` 同生命周期，模块级常量）。
- `loadJsLib(sourceKey: string, jsLib?: string): Promise<boolean>`：
  - `jsLib` 为空或为远程 URL（以 `http://`/`https://` 开头）→ 不加载，返回 `false`。
  - 否则视为内联 JS，缓存到 Map（若已缓存且内容一致，直接返回 `true`）。
  - 返回是否可用的内联 JS。
- `getJsLib(sourceKey: string): string`：返回已缓存的 jsLib 代码（无则 `""`）。

### 3.2 evalJs 注入 jsLib

- `evalJs(expr, ctx)` 内部：在拼接 body 时，若 `ctx.sourceKey` 有已缓存的 jsLib，则前缀注入：
  ```js
  body = `"use strict";\n${jsLibCode}\n${原body逻辑}`
  ```
- 这样 jsLib 中定义的函数（如 `GEN_EXPLORE`）进入同一函数作用域，可被 `@js:` 表达式直接调用。
- 若 jsLib 代码抛错，evalJs 现有 catch 兜底返回 `""`。

### 3.3 parseExploreUrl 支持 @js:

签名扩展为 `parseExploreUrl(exploreUrl: string, ctx?: { sourceKey?: string; source?: BookSource })`：

```
若 exploreUrl.trim() 以 "@js:" 开头:
    expr = exploreUrl.trim().slice(4)
    raw = evalJs(expr, { doc: emptyDoc(), result: "", sourceKey: ctx?.sourceKey, source: ctx?.source })
    str = String(raw ?? "").trim()
    若 str 为空 → 返回 []
    尝试 JSON.parse(str):
        成功且为数组 → 每项取 title ?? name（或 .title）与 url（或 .url），过滤无 url 项
        失败/非数组 → 按 /(&&|\n)+/ 分割，每段 "::" 拆分 → { title, url }（无 "::" 时 title=url）
否则 → 沿用现有按行解析
```

- 解析异常一律返回空数组，不抛错。

### 3.4 ExplorePage 接线

- 打开书源成功后：`await loadJsLib(s.bookSourceUrl, s.jsLib)`（失败忽略，仅影响 `@js:` 分类）。
- 分类解析：`setCategories(parseExploreUrl(s.exploreUrl ?? "", { sourceKey: s.bookSourceUrl, source: s }))`。

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/services/jsLib.ts` | 新建：loadJsLib / getJsLib + 会话缓存 |
| `src/services/bookSourceEngine.ts` | evalJs 注入 jsLib；parseExploreUrl 支持 @js: + 双格式 |
| `src/pages/ExplorePage.tsx` | 打开书源时 loadJsLib；分类解析传 sourceKey/source |
| `src/services/bookSourceEngine.test.ts` | 新增测试 |
| `src/services/jsLib.test.ts` | 新建测试 |

## 5. 测试

- jsLib 内联定义 `GEN_EXPLORE` → `@js:GEN_EXPLORE()` 返回分类（先 RED）。
- `@js:` 返回 JSON 数组 `[{title,url}]` 解析正确。
- `@js:` 返回字符串 `"玄幻::/x/\n都市::/d/"` 解析正确。
- `@js:` 自包含表达式 `@js:(()=>[{title,url}])()` 无 jsLib 也可执行。
- 无 jsLib 时普通 exploreUrl 按行解析行为不变。
- 现有测试全绿。

## 6. 错误处理

- jsLib eval 失败 / 远程 URL 不支持 → 静默忽略，分类为空数组。
- `@js:` 表达式抛错 → evalJs catch 返回 `""` → 空分类。
- JSON 解析失败 → 回退字符串分行解析。
