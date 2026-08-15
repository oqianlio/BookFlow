# 导航返回修复：back 从根区域改为上层完整状态

日期：2026-08-15
状态：待批准
前置：发现页分组频道（R13）引入多级导航后暴露返回缺陷。

## 1. 目标

修复多级下钻后返回跳层的问题：从「发现 → 分组频道 → 书源浏览 → 书籍详情 → 阅读」逐级进入后，点返回应**逐级回退**（阅读→书籍详情→书源浏览→分组频道→发现），而非直接跳回根区域。

## 2. 背景与问题

当前 `DetailState` 的 `back: AppArea` 只存**根区域**（如 "discover"）。所有下钻动作（explore → sourceBook → sourceReader 等）都写 `back: state.back`，而 `state.back` 是**最初始的根区域**，不是"上一层页面"。结果：无论下钻多深，返回都跳回根区域，中间层级（分组列表、书源浏览页）被跳过。

## 3. 非目标

- 不做浏览器式前进/后退历史（仅修复返回逐级回退）。
- 不改 SideNav 根区域切换逻辑。
- 不做返回动画/手势。

## 4. 架构

```
DetailState.back: AppArea  →  DetailState.back: AppState
（每个详情状态保存"进入前的完整上层状态"）

AppState = { area: AppArea } | DetailState

下钻：setState({ ...detail, back: currentState })   // currentState = 当前完整状态（可能是 detail 或根区域）
返回：setState(back)                                  // 恢复上层完整状态（自然逐级）

辅助函数：
  rootArea(s: AppState): AppArea   // 递归取根区域（供侧边栏高亮）
    s.area === "detail" ? rootArea(s.back) : s.area
```

### 4.1 类型与辅助

```ts
type DetailState = { ...; back: AppState };  // 全部 detail 分支的 back 改为 AppState

function rootArea(s: AppState): AppArea {
  return s.area === "detail" ? rootArea(s.back) : s.area;
}
```

### 4.2 导航点改造（App.tsx）

每个下钻处，back 传**当前 state**（而非写死根区域）：

| 位置 | 之前 | 之后 |
|---|---|---|
| discover→sourceBook | `back: "discover"` | `back: state`（当前是 { area: "discover" }） |
| discover→explore | `back: "discover"` | `back: state` |
| discover→groupExplore | `back: "discover"` | `back: state` |
| groupExplore→explore | `back: state.back`（根区域） | `back: state`（groupExplore 状态） |
| explore→sourceBook | `back: state.back` | `back: state`（explore 状态） |
| sourceBook→sourceReader | `back: state.back` | `back: state`（sourceBook 状态） |
| sourceBook 换源 | `back: state.back` | `back: state`（当前 sourceBook） |
| sourceReader→sourceBook（阅读返回） | 构造 hit + `back: state.back` | `back: state`（reader 状态）→ 但 ReaderPage onBack 语义是"返回"：应 `setState(back)` 直接回上层，不再构造 sourceBook |
| bookshelf→sourceReader（书架在线书） | `back: "bookshelf"` | `back: state` |
| bookshelf→reader（本地书） | `back: "bookshelf"` | `back: state` |
| my→sourceManager | `back: "my"` | `back: state` |
| rss→rssArticle | `back: "rss"` | `back: state` |
| sourceManager→debugSource | `back: "my"` | `back: state`（sourceManager 状态） |

**阅读页返回语义修正**：`sourceReader` 的 `onBack` 之前构造 sourceBook（因为 back 是根区域，返回会跳层）；改为 `onBack={() => setState(state.back)}` —— 直接恢复进入阅读前的状态（sourceBook）。这同时修复"阅读返回书籍信息丢失"（之前构造的 hit 缺 author/coverUrl）。

### 4.3 侧边栏高亮

`const area = state.area === "detail" ? state.back : state.area;` 改为 `const area = rootArea(state);`（递归，兼容 back 是 detail）。

### 4.4 边界

- back 为根区域状态（{ area: "discover" }）→ rootArea 返回 "discover"，返回即回根。
- 换源后 back 指向旧 sourceBook → 换源返回回到换源前的书籍页。
- 深度嵌套（groupExplore→explore→sourceBook→reader）→ 每层 back 是上层完整状态，逐级 pop。

## 5. 文件修改

| 文件 | 动作 |
|---|---|
| `src/App.tsx` | back 类型改 AppState + rootArea + 所有导航点 |
| `src/App.test.tsx` | 适配 + 新增多级返回用例 |

## 6. 测试

- App.test.tsx：新增用例模拟 发现→分组→书源→书籍→阅读→逐级返回 断言每步回到正确页面。
- 现有 App.test 用例适配（back 类型变化不影响渲染断言）。
- 其他测试：各页面 props 不含 back，不受影响。

## 7. 错误处理

- 无（纯状态机改造；确保 rootArea 对根状态直接返回）。
