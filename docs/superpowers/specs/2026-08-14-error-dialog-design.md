# 错误弹窗 + 一键复制设计文档

日期：2026-08-14
状态：已批准
前置：已完成 MD3 界面、书源引擎、导入、调试器等全部功能。

## 1. 目标

将应用所有报错从**内联红字**改为**居中弹窗**显示，弹窗含错误文本、「复制」按钮（一键复制到剪贴板）与「关闭」按钮。同一时刻只显示一个错误弹窗（最新错误替换旧的）。复制成功显示「已复制」瞬态提示。

## 2. 非目标

- 不处理全局未捕获异常（window.onerror）——本次只改造各页面显式 `setError` 的业务错误。（未捕获异常监控已在前一子项目实现，仍走日志转发。）
- 不做错误持久化/上报。
- 不做可堆叠多弹窗。

## 3. 架构

```
ErrorProvider（React Context + 全局单例弹窗）
  └─ <ErrorProvider> 包裹 App 根（所有页面可见）
      ├─ useError() → { showError(msg), clearError() }
      └─ 弹窗渲染：标题「出错了」+ 错误文本（可滚动）+ 「复制」+ 「关闭」
```

### 3.1 组件（新文件 `src/components/ErrorDialog.tsx`）

```tsx
interface ErrorContextValue {
  showError: (msg: string) => void;
  clearError: () => void;
}
export function useError(): ErrorContextValue;
export function ErrorProvider({ children }: { children: React.ReactNode }): JSX.Element;
```

- `showError(msg)`：设置 `{ message, ts }` 状态（`ts` 用于 key 强制替换，保证新错误刷新弹窗）。
- `clearError()`：关闭弹窗。
- 弹窗 JSX：遮罩 `.error-dialog-overlay` + 面板 `.error-dialog`：
  - `<h3>出错了</h3>`
  - `<pre className="error-dialog-message">{message}</pre>`（可滚动，`word-break: break-all`）
  - 按钮行：「复制」`btn-primary` + 「关闭」`btn-ghost`
- 复制：
  ```ts
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 回退：临时 textarea + document.execCommand("copy")
      const ta = document.createElement("textarea");
      ta.value = message; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  ```
- 「复制」按钮文字：`copied ? "已复制" : "复制"`。

### 3.2 挂载（App.tsx）

`App.tsx` 的 default export 外包一层：

```tsx
export default function App() {
  return (
    <ErrorProvider>
      <AppInner />
    </ErrorProvider>
  );
}
```

把现有 `App` 逻辑改名 `AppInner`。这样 detail 分支（单页 return）与主区分支都覆盖。

### 3.3 页面改造

各页面把 `setError(String(e))` / `setError("书源不存在")` 等调用改为 `const { showError } = useError();` + `showError(...)`：

| 文件 | 改造点 |
|---|---|
| `src/pages/LibraryPage.tsx` | `setError(String(e))` ×3 → showError |
| `src/pages/DiscoverPage.tsx` | `setError(String(e))` → showError |
| `src/pages/ExplorePage.tsx` | `setError` ×3 → showError |
| `src/pages/SourceBookPage.tsx` | `setError` ×3 → showError |
| `src/pages/SourceReaderPage.tsx` | `setError` ×2 → showError |
| `src/pages/DebugSourcePage.tsx` | `setError` ×4 → showError |
| `src/pages/HomePage.tsx` | `setError(String(e))` → showError |
| `src/components/BookSourceManager.tsx` | `setError(String(e))` → showError；importMsg 保留内联（成功提示非错误） |

**内联渲染处理**：页面顶部 `{error && <p className="error">...}` 渲染保留（避免大面积删改），但 `error` state 不再被业务错误填充（改为弹窗）。为最小改动，**保留 error state 与内联渲染结构**，仅把赋值来源换成 `showError`——但这样内联渲染永不再出现。更干净：删除内联渲染，仅留弹窗。**决策：删除各页面内联 `.error` 渲染块，错误统一走弹窗**。

注意：`error` state 若还被用于条件逻辑（如按钮 disabled、空态判断），保留 state；否则一并移除。以逐页实际使用为准。

### 3.4 样式（App.css 追加）

```css
.error-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); }
.error-dialog { width: min(440px, 90vw); max-height: 70vh; display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: var(--radius-md); background: var(--surface-container-lowest); box-shadow: var(--shadow-lg); }
.error-dialog h3 { margin: 0; font-size: 16px; color: var(--error); }
.error-dialog-message { margin: 0; padding: 12px; background: var(--surface-container-high); border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12.5px; color: var(--on-surface); white-space: pre-wrap; word-break: break-all; overflow: auto; max-height: 40vh; }
.error-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
```

## 4. 文件修改

| 文件 | 动作 |
|---|---|
| `src/components/ErrorDialog.tsx` | 新建：ErrorProvider + useError + 弹窗 |
| `src/components/ErrorDialog.test.tsx` | 新建测试 |
| `src/App.tsx` | 包 ErrorProvider，App 改 AppInner |
| 各页面/组件 | setError → showError，删内联 error 渲染 |
| `src/App.css` | 弹窗样式 |

## 5. 测试

- ErrorProvider：`showError` 显示弹窗文本；`clearError` 关闭；连续两次 `showError` 替换内容。
- 「复制」按钮调用 `navigator.clipboard.writeText`（mock），成功后按钮变「已复制」。
- 至少一个页面（如 ExplorePage）验证 setError 路径被 showError 取代、内联 error 不再渲染。
- 现有测试全绿。

## 6. 错误处理

- `navigator.clipboard` 不可用（Tauri WebView 权限）→ 回退 `document.execCommand("copy")` + 临时 textarea。
- 复制失败仍提示「已复制」（尽力而为）或提示复制失败——取简单：回退后仍显示已复制。
