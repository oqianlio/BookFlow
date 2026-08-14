# 错误弹窗 + 一键复制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用所有业务报错从内联红字改为居中弹窗显示，弹窗含错误文本、「复制」（一键复制到剪贴板）与「关闭」按钮；同一时刻单个弹窗。

**Architecture:** 新建 `src/components/ErrorDialog.tsx`（React Context：`useError()` → `{ showError, clearError }` + 全局单例弹窗）；`App.tsx` 外层包 `ErrorProvider`；各页面把 `setError(...)` 改为 `showError(...)` 并删除内联 `.error` 渲染。

**Tech Stack:** React 19 + TypeScript + vitest（jsdom）。无新依赖。

## Global Constraints

- `navigator.clipboard.writeText` 不可用（Tauri WebView 权限）时回退 `document.execCommand("copy")` + 临时 textarea。
- 同一时刻单个弹窗，新的 `showError` 替换旧的（用递增 key 强制刷新）。
- ReaderPage 的 `.error-box`（阅读页内联错误）**保留不动**（阅读页独立纸张主题，不接弹窗）。
- 现有测试保持绿：`npm test`（当前 214），`npm run build`（tsc + vite）通过。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/components/ErrorDialog.tsx` | ErrorProvider + useError + 弹窗 + 复制 | 新建 |
| `src/components/ErrorDialog.test.tsx` | 弹窗/复制测试 | 新建 |
| `src/App.tsx` | 包 ErrorProvider，原 App 改名 AppInner | 修改 |
| `src/App.css` | `.error-dialog-*` 样式 | 修改 |
| `src/pages/DiscoverPage.tsx` | setError → showError，删内联渲染 | 修改 |
| `src/pages/ExplorePage.tsx` | 同上 | 修改 |
| `src/pages/LibraryPage.tsx` | 同上 | 修改 |
| `src/pages/SourceBookPage.tsx` | 同上 | 修改 |
| `src/pages/SourceReaderPage.tsx` | 同上 | 修改 |
| `src/pages/DebugSourcePage.tsx` | 同上 | 修改 |
| `src/pages/HomePage.tsx` | 同上 | 修改 |
| `src/components/BookSourceManager.tsx` | 同上（importMsg 保留内联） | 修改 |

## 任务依赖

Task 1（ErrorDialog + App 挂载）→ Task 2（页面迁移）。

---

### Task 1: ErrorDialog 组件 + App 挂载

**Files:**
- Create: `src/components/ErrorDialog.tsx`
- Test: `src/components/ErrorDialog.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: 无（纯新组件）。
- Produces:
  ```ts
  export function useError(): { showError: (msg: string) => void; clearError: () => void };
  export function ErrorProvider({ children }: { children: React.ReactNode }): JSX.Element;
  ```

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/ErrorDialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorProvider, useError } from "./ErrorDialog";

function Harness() {
  const { showError, clearError } = useError();
  return (
    <div>
      <button onClick={() => showError("测试错误")}>触发</button>
      <button onClick={() => showError("新错误")}>触发新</button>
      <button onClick={clearError}>清除</button>
    </div>
  );
}

function renderWithProvider() {
  return render(<ErrorProvider><Harness /></ErrorProvider>);
}

describe("ErrorDialog", () => {
  beforeEach(() => { vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows error dialog on showError and hides on clearError", async () => {
    renderWithProvider();
    expect(screen.queryByText("出错了")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    expect(screen.getByText("出错了")).toBeInTheDocument();
    expect(screen.getByText("测试错误")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("出错了")).not.toBeInTheDocument();
  });

  it("replaces message on second showError (single dialog)", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    await userEvent.click(screen.getByRole("button", { name: "触发新" }));
    expect(screen.getByText("新错误")).toBeInTheDocument();
    expect(screen.queryByText("测试错误")).not.toBeInTheDocument();
  });

  it("copies error text to clipboard on 复制 click", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    await userEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("测试错误");
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/ErrorDialog.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 ErrorDialog.tsx**

```tsx
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

interface ErrorContextValue {
  showError: (msg: string) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextValue>({
  showError: () => {},
  clearError: () => {},
});

export function useError(): ErrorContextValue {
  return useContext(ErrorContext);
}

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const showError = (msg: string) => {
    setMessage(String(msg));
    setSeq((n) => n + 1);
    setCopied(false);
  };
  const clearError = () => {
    setMessage(null);
    setCopied(false);
  };

  const copy = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ErrorContext.Provider value={{ showError, clearError }}>
      {children}
      {message !== null && (
        <div className="error-dialog-overlay" key={seq}>
          <div className="error-dialog" role="alertdialog" aria-label="错误">
            <h3>出错了</h3>
            <pre className="error-dialog-message">{message}</pre>
            <div className="error-dialog-actions">
              <button className="btn btn-primary" onClick={() => void copy()}>
                {copied ? "已复制" : "复制"}
              </button>
              <button className="btn btn-ghost" onClick={clearError}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </ErrorContext.Provider>
  );
}
```

- [ ] **Step 4: 挂载 App.tsx**

把 `export default function App()` 改为 `export default function AppInner()`，新增包裹：

```tsx
import { ErrorProvider } from "./components/ErrorDialog";

export default function App() {
  return (
    <ErrorProvider>
      <AppInner />
    </ErrorProvider>
  );
}

function AppInner() {
  // ...原有 App 逻辑不变
}
```

- [ ] **Step 5: 样式（App.css 追加）**

```css
.error-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); }
.error-dialog { width: min(440px, 90vw); max-height: 70vh; display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: var(--radius-md); background: var(--surface-container-lowest); box-shadow: var(--shadow-lg); }
.error-dialog h3 { margin: 0; font-size: 16px; color: var(--error); }
.error-dialog-message { margin: 0; padding: 12px; background: var(--surface-container-high); border: 1px solid var(--outline-variant); border-radius: var(--radius-sm); font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12.5px; color: var(--on-surface); white-space: pre-wrap; word-break: break-all; overflow: auto; max-height: 40vh; }
.error-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
```

- [ ] **Step 6: 运行测试 + 构建**

Run: `npx vitest run src/components/ErrorDialog.test.tsx` PASS；`npm test` 全绿；`npm run build` 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/ErrorDialog.tsx src/components/ErrorDialog.test.tsx src/App.tsx src/App.css
git commit -m "feat: 错误弹窗 + 一键复制"
```

---

### Task 2: 页面迁移 setError → showError

**Files:**
- Modify: `src/pages/DiscoverPage.tsx`, `src/pages/ExplorePage.tsx`, `src/pages/LibraryPage.tsx`, `src/pages/SourceBookPage.tsx`, `src/pages/SourceReaderPage.tsx`, `src/pages/DebugSourcePage.tsx`, `src/pages/HomePage.tsx`, `src/components/BookSourceManager.tsx`

**Interfaces:**
- Consumes: `useError` from `./ErrorDialog`（Task 1）。
- Produces: 无新接口。

- [ ] **Step 1: 迁移模式（以 ExplorePage 为例，其余页面相同）**

对每个文件：
1. 组件内加 `const { showError } = useError();`（`import { useError } from "../components/ErrorDialog";`）。
2. 把 `setError(String(e))` 改为 `showError(String(e))`；把 `setError("书源不存在")` 等固定文案改为 `showError(...)`。
3. 若 `error` state 不再被任何条件逻辑引用，删除 `useState` 声明与内联渲染 `{error && <p className="error">{error}</p>}`；若仍被引用（如空态判断、按钮 disabled），保留 state 但**不再用它渲染错误文本**，仅删内联渲染块。
4. 注意区分：`setError(null)`（清除）改删或改调 `clearError()`——仅在确实清空错误场景时保留（多数页面在操作开始前 `setError(null)`，可直接删掉该行，因为弹窗由新错误替换）。

每个页面具体改造点：

**ExplorePage.tsx**（line 13/24/30/38/58/72）：
```tsx
import { useError } from "../components/ErrorDialog";
const { showError } = useError();
// line 24: showError("书源不存在")
// line 30: showError(String(e))
// line 38: 删 setError(null)
// line 58: showError(String(e))
// line 72: 删 {error && <p className="error">{error}</p>}
// line 13: 若 error 无他用，删 useState<error>
```

**DiscoverPage.tsx**（line 33/60/66/87）：
```tsx
const { showError } = useError();
// 60: 删 setError(null)；66: showError(String(e))；87: 删内联渲染
```

**LibraryPage.tsx**（line 12/19/27/32/44/79）：
```tsx
const { showError } = useError();
// 19/32/44: showError(String(e))；27: 删 setError(null)；79: 删内联渲染
// 若 error 仅用于渲染，删 useState；若有他用保留
```

**SourceBookPage.tsx**（line 13/21/24/58/80）：
```tsx
const { showError } = useError();
// 21/24: showError("书源不存在"/"书籍地址无效，无法打开")；58: showError(String(e))；80: 删内联渲染
```

**SourceReaderPage.tsx**（line 20/29/32/54/144）：
```tsx
const { showError } = useError();
// 29: 删 setError(null)；32: showError("书源不存在")；54: showError(String(e))；144: 删 <p className="error">
// 注意 144 行外层可能是 {error && ...}，整块删除
```

**DebugSourcePage.tsx**（line 19/25/26/35/38/47/52/60/68/84）：
```tsx
const { showError } = useError();
// 25/35: showError("书源不存在")；26/47/60: 删 setError(null)；38/52/68: showError(String(e))；84: 删 <p className="error">
// 该页 error 可能与重试逻辑关联：保留 error state 若 retry 依赖它；否则删除
```

**HomePage.tsx**（line 28/37/43）：
```tsx
const { showError } = useError();
// 37: showError(String(e))；43: 删除 `if (error) return <div className="page"><p className="error">{error}</p></div>;`
// 若 error 仅此用，删 useState
```

**BookSourceManager.tsx**（line 149 + 多处 setError）：
```tsx
const { showError } = useError();
// 所有 setError(String(e)) → showError(String(e))
// importMsg 保留内联（成功提示，非错误）——不迁移
// 149: 删 {error && <p className="error">{error}</p>}
// 注意：error 可能用于某些禁用/条件逻辑，保留 state 但删渲染
```

- [ ] **Step 2: 运行全量测试**

Run: `npm test`
注意：现有页面测试可能断言 `screen.getByText(...)` 错误文案或 `queryByText` 内联错误。若测试因错误不再内联渲染而失败，更新为断言弹窗出现（需包 `<ErrorProvider>`）或移除过时断言。以实际运行为准修正。

- [ ] **Step 3: 构建验证**

Run: `npm run build` 通过。

- [ ] **Step 4: Commit**

```bash
git add src/pages/DiscoverPage.tsx src/pages/ExplorePage.tsx src/pages/LibraryPage.tsx src/pages/SourceBookPage.tsx src/pages/SourceReaderPage.tsx src/pages/DebugSourcePage.tsx src/pages/HomePage.tsx src/components/BookSourceManager.tsx
git commit -m "refactor: 页面错误改为弹窗显示"
```

- [ ] **Step 5: 终审清单**

- [ ] ErrorProvider 包裹 App 全部 return 分支（detail + 主区）✓
- [ ] 8 个文件 setError → showError ✓
- [ ] 内联 `.error` 渲染已删（ReaderPage 除外）✓
- [ ] importMsg 保留（成功提示）✓
- [ ] 复制：clipboard 优先 + execCommand 回退 ✓
- [ ] 单例弹窗，新错误替换旧 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 错误弹窗终审修复`）。

---
