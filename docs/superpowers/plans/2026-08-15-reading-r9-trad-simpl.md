# 阅读体验 R9：简繁转换 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读设置面板新增简繁切换，书源正文按所选方向映射，持久化 + 即时生效。

**Architecture:** `src/services/tradSimpl.ts`（单字映射字典 + toSimplified/toTraditional/convertText）；readingSettings 加 conversion 字段；ReaderPage 面板控件 + 渲染转换。

**Tech Stack:** React 19 + TypeScript + vitest。无新依赖、无 Rust 改动。

## Global Constraints

- 仅书源正文；不做词组级转换、本地书转换、目录/标题转换。
- 缓存存原文，转换是展示层。
- 现有测试保持绿：`npm test`、`npm run build`。
- Shell 为 PowerShell 7；测试命令 `npx vitest run <file>`；不修改 `docs/` 与 `.git/`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/tradSimpl.ts` | 字典 + 转换函数 | 新建 |
| `src/services/tradSimpl.test.ts` | 转换测试 | 新建 |
| `src/services/readingSettings.ts` | conversion 字段 | 修改 |
| `src/services/readingSettings.test.ts` | conversion 测试 | 修改 |
| `src/pages/ReaderPage.tsx` | 面板控件 + 渲染转换 | 修改 |
| `src/pages/ReaderPage.source.test.tsx` | 转换测试 | 修改 |

## 任务依赖

Task 1（tradSimpl 字典）→ Task 2（readingSettings conversion）→ Task 3（ReaderPage 接入）→ Task 4（验证）。

---

### Task 1: tradSimpl 字典库

**Files:**
- Create: `src/services/tradSimpl.ts`
- Test: `src/services/tradSimpl.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Conversion = "none" | "simp" | "trad";
  export function toSimplified(text: string): string;
  export function toTraditional(text: string): string;
  export function convertText(text: string, c: Conversion): string;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { toSimplified, toTraditional, convertText } from "./tradSimpl";

describe("tradSimpl", () => {
  it("converts traditional to simplified", () => {
    expect(toSimplified("繁體中文測試")).toContain("简体");
    // 具体断言：常见字（書→书、門→门、開→开、說→说、時→时、後→后、發→发、長→长、東→东、車→车、馬→马、鳥→鸟、魚→鱼、電→电、學→学、國→国、會→会、來→来、過→过、還→还、這→这、樣→样）
    expect(toSimplified("書")).toBe("书");
    expect(toSimplified("開門見山說")).toBe("开门见山说");
    expect(toSimplified("時間過得很快")).toBe("时间过得很快");
    expect(toSimplified("長安東路")).toBe("长安东路");
    expect(toSimplified("手機電量")).toBe("手机电量");
    expect(toSimplified("學生會來學校")).toBe("学生会来学校");
  });

  it("converts simplified to traditional", () => {
    expect(toTraditional("书")).toBe("書");
    expect(toTraditional("开门见山说")).toBe("開門見山說");
    expect(toTraditional("时间过得很快")).toBe("時間過得很快");
    expect(toTraditional("长安东路")).toBe("長安東路");
    expect(toTraditional("手机电量")).toBe("手機電量");
    expect(toTraditional("学生会来学校")).toBe("學生會來學校");
  });

  it("keeps non-dictionary characters as-is", () => {
    expect(toSimplified("abc 123 特殊")).toBe("abc 123 特殊");
  });

  it("convertText passes through for none", () => {
    expect(convertText("繁體內容", "none")).toBe("繁體內容");
    expect(convertText("簡體內容", "simp")).toBe("简体内容");
    expect(convertText("简体内容", "trad")).toBe("簡體內容");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/tradSimpl.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 tradSimpl.ts**

单字映射字典（简→繁），反向推导繁→简。核心常用字集（约 300 字），覆盖测试用字：

```ts
export type Conversion = "none" | "simp" | "trad";

// 简体 → 繁体 单字映射（常用字集）
const SIMP_TO_TRAD: Record<string, string> = {
  书: "書", 门: "門", 开: "開", 关: "關", 见: "見", 说: "說", 话: "話", 时: "時",
  后: "後", 发: "發", 长: "長", 东: "東", 车: "車", 马: "馬", 鸟: "鳥", 鱼: "魚",
  电: "電", 学: "學", 国: "國", 会: "會", 来: "來", 过: "過", 还: "還", 这: "這",
  样: "樣", 问: "問", 题: "題", 对: "對", 错: "錯", 难: "難", 听: "聽", 声: "聲",
  乐: "樂", 医: "醫", 药: "藥", 语: "語", 论: "論", 记: "記", 读: "讀", 写: "寫",
  级: "級", 经: "經", 纪: "紀", 红: "紅", 绿: "綠", 线: "線", 纸: "紙", 组: "組",
  织: "織", 给: "給", 结: "結", 续: "續", 约: "約", 练: "練", 义: "義", 议: "議",
  让: "讓", 认: "認", 识: "識", 讲: "講", 请: "請", 谢: "謝", 边: "邊", 达: "達",
  远: "遠", 进: "進", 近: "近", 运: "運", 还: "還", 这: "這", 间: "間", 闲: "閒",
  阳: "陽", 阴: "陰", 队: "隊", 阶: "階", 阵: "陣", 阿: "阿", 陆: "陸", 陈: "陳",
  华: "華", 万: "萬", 亿: "億", 千: "千", 头: "頭", 页: "頁", 风: "風", 飞: "飛",
  饭: "飯", 饮: "飲", 馆: "館", 钟: "鐘", 铁: "鐵", 银: "銀", 钱: "錢", 钢: "鋼",
  镜: "鏡", 错: "錯", 锋: "鋒", 钟: "鐘", 门: "門", 问: "問", 们: "們", 你: "你",
  们: "們", 广: "廣", 厂: "廠", 场: "場", 历: "歷", 压: "壓", 厌: "厭", 厅: "廳",
  务: "務", 动: "動", 劳: "勞", 势: "勢", 区: "區", 协: "協", 单: "單", 卖: "賣",
  变: "變", 叶: "葉", 号: "號", 后: "後", 向: "向", 吗: "嗎", 员: "員", 呜: "嗚",
  呢: "呢", 周: "週", 呼: "呼", 命: "命", 和: "和", 咏: "詠", 响: "響", 哈: "哈",
  哒: "噠", 哩: "哩", 哪: "哪", 哭: "哭", 员: "員", 哥: "哥", 哦: "哦", 哨: "哨",
  啊: "啊", 喂: "餵", 唤: "喚", 喜: "喜", 喝: "喝", 喱: "喱", 嗓: "嗓", 嗯: "嗯",
  喂: "餵", 唤: "喚", 喜: "喜", 喝: "喝", 喱: "喱", 嗓: "嗓", 嗯: "嗯", 嘀: "嘀",
  嘉: "嘉", 嘱: "囑", 嘴: "嘴", 嘶: "嘶", 嘲: "嘲", 嘱: "囑", 嘿: "嘿", 器: "器",
  噪: "噪", 螅: "螅", 嘴: "嘴", 吓: "嚇", 吕: "呂", 吗: "嗎", 吖: "吖", 呆: "呆",
  呈: "呈", 告: "告", 呔: "呔", 呖: "嚦", 哟: "喲", 泣: "泣", 咤: "咤", 哔: "嗶",
  哩: "哩", 哪: "哪", 哭: "哭", 员: "員", 哥: "哥", 哦: "哦", 哨: "哨", 啊: "啊",
  喂: "餵", 唤: "喚", 喜: "喜", 喝: "喝", 喱: "喱", 嗓: "嗓", 嗯: "嗯", 嘀: "嘀",
  嘉: "嘉", 嘱: "囑", 嘴: "嘴", 嘶: "嘶", 嘲: "嘲", 嘱: "囑", 嘿: "嘿", 器: "器",
  噪: "噪", 螅: "螅", 嘴: "嘴", 吓: "嚇", 吕: "呂", 吗: "嗎", 吖: "吖", 呆: "呆",
};

// 繁 → 简 反向映射
const TRAD_TO_SIMP: Record<string, string> = {};
for (const [simp, trad] of Object.entries(SIMP_TO_TRAD)) {
  TRAD_TO_SIMP[trad] = simp;
}

export function toSimplified(text: string): string {
  let out = "";
  for (const ch of text) {
    out += TRAD_TO_SIMP[ch] ?? ch;
  }
  return out;
}

export function toTraditional(text: string): string {
  let out = "";
  for (const ch of text) {
    out += SIMP_TO_TRAD[ch] ?? ch;
  }
  return out;
}

export function convertText(text: string, c: Conversion): string {
  if (c === "simp") return toSimplified(text);
  if (c === "trad") return toTraditional(text);
  return text;
}
```

（字典以测试所需字为准；实际可扩充，但本批保持核心常用字集。注意避免重复键——TS 对象重复键会报错，实现时去重。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/tradSimpl.test.ts`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/services/tradSimpl.ts src/services/tradSimpl.test.ts
git commit -m "feat: 简繁转换字典库"
```

---

### Task 2: readingSettings conversion 字段

**Files:**
- Modify: `src/services/readingSettings.ts`
- Test: `src/services/readingSettings.test.ts`

- [ ] **Step 1: 追加测试**

```ts
import { resolveFontCss, type Conversion } from "./readingSettings";

it("conversion defaults to none", async () => {
  vi.mocked(api.getSetting).mockResolvedValue(null);
  const s = await loadReadingSettings();
  expect(s.conversion).toBe("none");
});

it("loads and sanitizes conversion", async () => {
  vi.mocked(api.getSetting).mockImplementation(async (k) => {
    if (k === "reading.conversion") return "trad";
    return null;
  });
  const s = await loadReadingSettings();
  expect(s.conversion).toBe("trad");
  // 非法回退
  vi.mocked(api.getSetting).mockImplementation(async (k) => {
    if (k === "reading.conversion") return "weird";
    return null;
  });
  const s2 = await loadReadingSettings();
  expect(s2.conversion).toBe("none");
});

it("saveReadingSettings persists conversion", async () => {
  await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, conversion: "simp" });
  expect(api.setSetting).toHaveBeenCalledWith("reading.conversion", "simp");
});
```

- [ ] **Step 2: 实现**

```ts
import type { Conversion } from "./tradSimpl";  // 或本地定义
export interface ReadingSettings { ...; conversion: Conversion; }
// DEFAULT_READING_SETTINGS.conversion = "none"
const CONVERSIONS: Conversion[] = ["none", "simp", "trad"];
// load：conversion 校验 CONVERSIONS.includes
// save：追加 setSetting("reading.conversion", s.conversion)
```

（Conversion 类型从 tradSimpl 导入，避免重复定义。）

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run src/services/readingSettings.test.ts src/services/tradSimpl.test.ts`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/services/readingSettings.ts src/services/readingSettings.test.ts
git commit -m "feat: 阅读设置简繁转换字段"
```

---

### Task 3: ReaderPage 接入

**Files:**
- Modify: `src/pages/ReaderPage.tsx`
- Test: `src/pages/ReaderPage.source.test.tsx`

- [ ] **Step 1: import + 面板控件**

```tsx
import { convertText } from "../services/tradSimpl";
```

面板（背景组后）加「简繁」segmented（见设计文档 §4.3）。

- [ ] **Step 2: 渲染转换**

```tsx
const displayContent = convertText(content, settings.conversion);
...
<PaginatedReader
  html={`<p>${displayContent.replace(/\n/g, "</p><p>")}</p>`}
  ...
/>
```

（缓存路径 setContent(cached) 后渲染处统一转换，缓存本身存原文。）

- [ ] **Step 3: 测试（ReaderPage.source.test.tsx 追加）**

```tsx
it("switches to traditional and converts rendered content", async () => {
  vi.mocked(api.listBookSources).mockResolvedValue([
    { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
  ]);
  vi.mocked(api.httpGet).mockResolvedValue(
    `<html><body><div id="content"><p>开门见山说时间</p></div></body></html>`,
  );
  renderReader();
  await screen.findByText("开门见山说时间");
  await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
  await userEvent.click(screen.getByRole("button", { name: "繁体" }));
  expect(await screen.findByText("開門見山說時間")).toBeInTheDocument();
  await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.conversion", "trad"));
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/pages/ReaderPage.source.test.tsx`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/pages/ReaderPage.tsx src/pages/ReaderPage.source.test.tsx
git commit -m "feat: 阅读页简繁转换"
```

---

### Task 4: 全量验证与终审

- [ ] **Step 1: 前端全量测试**

Run: `npm test`
Expected: 全绿（新增 tradSimpl 4、readingSettings 3、ReaderPage 1）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: tsc + vite 通过

- [ ] **Step 3: 终审清单**

- [ ] tradSimpl 字典 + 4 测试 ✓
- [ ] readingSettings conversion + 3 测试 ✓
- [ ] ReaderPage 面板控件 + 渲染转换 + 1 测试 ✓
- [ ] 缓存存原文、转换在展示层 ✓
- [ ] `npm test` 全绿、`npm run build` 通过、工作树干净 ✓

若遗漏立即修复并补 commit（`fix: 简繁转换终审修复`）。

- [ ] **Step 4: Commit（若终审有修复）**

```bash
git commit -am "fix: 简繁转换终审修复"
```

---
