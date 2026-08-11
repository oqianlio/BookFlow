# 子项目5：规则变量（java.put/get + source 变量）设计文档

日期：2026-08-11
状态：已批准

## 1. 背景与目标

部分 legado 书源的 `@js:` 脚本用 `java.put(key, value)`/`java.get(key)` 在请求间/脚本间存储临时值（翻页游标、登录 token 等），或依赖 `source.getVariable()`/`source.putVariable()` 读写书源变量。当前「枕书」的 `evalJs`：
- `java` 对象缺 `put`/`get`（无变量存取）。
- `source.getVariable` 是空占位（返回 `""`），`source.putVariable` 不存在。

为对齐 legado 3.0，本子项目实现规则变量系统：`java.put/get` + `source.getVariable/putVariable`（session 级、按书源隔离）。

**参考**：legado-md3 `JsExtensions.kt`（java.put/get）、`NativeBaseSource.kt`（source 变量代理）、`CacheManager`（会话缓存）。legado 的 `@put:`/`@get:` 是 `java.put/get` 的 JS 别名，非独立规则前缀。

## 2. 非目标

- 不做变量持久化到磁盘（legado 变量是 session/会话级，重启丢失）。
- 不实现 legado 的 `@put:`/`@get:` 独立规则前缀语法（经 `java.put/get` 在 JS 内完成，多数书源如此）。
- 不实现变量跨书源共享（按书源 key 隔离）。

## 3. 技术架构

```
evalJs(expr, ctx)
  ├─ java.put(key, value) / java.get(key)   → 会话变量存储（按书源 key 隔离）
  ├─ source.getVariable() / putVariable(k,v) → 同存储（书源级变量，兼容 TYPE() 等）
  └─ 存储：模块级 Map<sourceKey, Map<string, string>>（session 级）
```

- 新增 `src/services/sourceVars.ts`：`getSourceVars(sourceKey)` 返回该书源变量 Map；`java.put`/`java.get`/`source.getVariable`/`source.putVariable` 都读写它。
- 变量值为字符串（legado 语义）。

## 4. 文件改动

- **`src/services/sourceVars.ts`（新建）**：
  - `export function getSourceVars(sourceKey: string): Map<string, string>` — 返回该书源变量存储（不存在则创建）。
  - `export function resetSourceVars(sourceKey: string): void` — 清空书源变量。
- **`src/services/bookSourceEngine.ts`**：
  - `evalJs` 的 `java` 加 `put`/`get`：
    ```ts
    put: (k: string, v: any) => { vars.set(String(k), String(v)); },
    get: (k: string) => vars.get(String(k)) ?? "",
    ```
  - `source.getVariable`/`source.putVariable` 真正实现（非占位）：
    ```ts
    source.getVariable = () => String(vars.get("variable") ?? "");
    source.putVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
    source.setVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
    ```
  - 变量存储按书源隔离：`evalJs` 需知道当前 sourceKey。`JsContext` 增加 `sourceKey?: string`；无则用全局默认 key（`"default"`）。各页面（DiscoverPage/SourceBookPage/SourceReaderPage/ExplorePage）调用 `extractList`/`extractSingle` 时传 `sourceKey`（书源域名或 id）。
- **页面接入**：搜索/目录/正文/探索的提取调用传 `sourceKey`（书源 `bookSourceUrl` 域名或 `bs.id`）。
- **测试**：
  - `sourceVars.test.ts`：按 key 隔离、put/get 往返、reset。
  - `bookSourceEngine.test.ts`：`evalJs("java.put('a','1'); java.get('a')")`；`source.putVariable('x'); source.getVariable()` 跨两次 evalJs 调用保持（同 key）；`TYPE()` 仍工作。
  - 页面：传 sourceKey 后变量在搜索→目录→正文间保持。

## 5. 测试

- `java.put/get` 往返、默认值、按 key 隔离。
- `source.getVariable/putVariable` 往返、跨调用保持。
- `resetSourceVars` 清空。
- `TYPE()` 兼容（读 source.getVariable）。
- 现有测试保持绿：`npm test`（156 个）。

## 6. 交付文件

- `src/services/sourceVars.ts`（新建）
- `src/services/sourceVars.test.ts`（新建）
- `src/services/bookSourceEngine.ts`（JsContext.sourceKey + java.put/get + source 变量）
- `src/services/bookSourceEngine.test.ts`
- `src/pages/DiscoverPage.tsx` / `SourceBookPage.tsx` / `SourceReaderPage.tsx` / `ExplorePage.tsx`（传 sourceKey）

## 7. 已知限制

- 变量 session 级（重启丢失），与 legado 一致。
- 变量按书源 key 隔离，跨书源不共享。
- `@put:`/`@get:` 独立前缀语法不支持（经 java.put/get 在 JS 内实现）。
