// 全链路书源健康检查：对每个启用书源依次验证 搜索 → 目录 → 正文，
// 统计各环节可用率与失败分类（网络 vs 规则提取 vs 站内无），
// 用于定位"能搜到但读不了"的规则缺口。
// 仅当设置 SOURCE_HEALTH=1 时运行（避免拖慢常规测试/依赖网络）。
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as api from "./api";
import { parseBookSourceJson, resolveSearchUrl, extractBookList, extractList, extractSingle, resolveUrl, parseHtml, hostOf, type BookSource as Src } from "./bookSourceEngine";
import { mergeUserAgent } from "./api";

const ENABLED = !!process.env.SOURCE_HEALTH;
const KEYWORD = process.env.SOURCE_KEYWORD ?? "我的";
const NAME_FILTER = process.env.SOURCE_NAME ?? "";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    httpGet: vi.fn(async (url: string, headers?: Record<string, string>, timeoutMs?: number, method?: string, body?: string) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs ?? 8000);
      try {
        const res = await fetch(url, {
          method: method ?? "GET",
          body: method && method !== "GET" && body ? body : undefined,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ...(method && method !== "GET" && body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
            ...(headers ?? {}),
          },
          signal: ctrl.signal,
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          return new TextDecoder("gbk").decode(buf);
        }
      } finally {
        clearTimeout(t);
      }
    }),
  };
});

interface StageResult {
  ok: boolean;
  /** 分类：ok / network（网络失败）/ empty（提取为空，规则或站内）/ norule（源无此环节规则，不算失败） */
  cls: "ok" | "network" | "empty" | "norule";
  detail: string;
}

function classify(e: unknown): StageResult {
  const msg = String(e);
  if (/fetch failed|abort|timed out|HTTP \d|ERR_|超时/i.test(msg)) return { ok: false, cls: "network", detail: msg.slice(0, 80) };
  return { ok: false, cls: "network", detail: msg.slice(0, 80) };
}

async function searchStage(src: Src, key: string): Promise<{ res: StageResult; bookUrl: string }> {
  try {
    const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1, { sourceKey: src.bookSourceUrl, source: src });
    if (!parsed.url) return { res: { ok: false, cls: "norule", detail: "无搜索URL" }, bookUrl: "" };
    const url = resolveUrl(parsed.url, src.bookSourceUrl);
    const html = await api.httpGet(url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), 8000, parsed.method, parsed.body, undefined, hostOf(src.bookSourceUrl));
    if (!html || html.length < 80) return { res: { ok: false, cls: "empty", detail: "响应过短" }, bookUrl: "" };
    const doc = parseHtml(html);
    const items = await extractBookList(doc, src.ruleSearch ?? {}, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl, source: src });
    if (items.length === 0) return { res: { ok: false, cls: "empty", detail: "无结果" }, bookUrl: "" };
    return { res: { ok: true, cls: "ok", detail: `${items.length}本` }, bookUrl: items[0]?.bookUrl ?? "" };
  } catch (e) {
    return { res: classify(e), bookUrl: "" };
  }
}

async function tocStage(src: Src, bookUrl: string): Promise<{ res: StageResult; chUrl: string }> {
  const rules = src.ruleToc ?? {};
  if (!rules.chapterList) return { res: { ok: true, cls: "norule", detail: "无目录规则" }, chUrl: "" };
  try {
    const base = src.bookSourceUrl || bookUrl;
    const resolved = bookUrl.startsWith("http") ? bookUrl : resolveUrl(bookUrl, base);
    const html = await api.httpGet(resolved, mergeUserAgent(src.httpHeaders, src.httpUserAgent), 5000, undefined, undefined, undefined, hostOf(src.bookSourceUrl));
    const doc = parseHtml(html);
    const items = await extractList(doc, rules.chapterList, {
      name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
    }, { baseUrl: resolved, result: html, sourceKey: src.bookSourceUrl, source: src });
    if (items.length === 0) return { res: { ok: false, cls: "empty", detail: "目录提取为空" }, chUrl: "" };
    return { res: { ok: true, cls: "ok", detail: `${items.length}章` }, chUrl: items[0]?.url ?? "" };
  } catch (e) {
    return { res: classify(e), chUrl: "" };
  }
}

async function contentStage(src: Src, chUrl: string): Promise<StageResult> {
  if (!src.ruleContent?.content) return { ok: true, cls: "norule", detail: "无正文规则" };
  try {
    const html = await api.httpGet(chUrl, mergeUserAgent(src.httpHeaders, src.httpUserAgent), 5000, undefined, undefined, undefined, hostOf(src.bookSourceUrl));
    const doc = parseHtml(html);
    const content = await extractSingle(doc, src.ruleContent.content, { baseUrl: chUrl, result: html, sourceKey: src.bookSourceUrl, source: src });
    const len = (content ?? "").trim().length;
    if (len < 30) return { ok: false, cls: "empty", detail: `正文过短(${len}字符)` };
    return { ok: true, cls: "ok", detail: `${len}字符` };
  } catch (e) {
    return classify(e);
  }
}

async function checkOne(s: { name: string; json: string }): Promise<{
  name: string;
  search: StageResult;
  toc: StageResult;
  content: StageResult;
}> {
  const src = parseBookSourceJson(s.json);
  const searchR = await searchStage(src, KEYWORD);
  const search = searchR.res;
  let toc: StageResult = { ok: true, cls: "norule", detail: "搜索失败跳过" };
  let content: StageResult = { ok: true, cls: "norule", detail: "跳过" };
  if (search.ok && searchR.bookUrl) {
    const tocR = await tocStage(src, searchR.bookUrl);
    toc = tocR.res;
    if (tocR.chUrl) {
      const chUrl = tocR.chUrl.startsWith("http") ? tocR.chUrl : resolveUrl(tocR.chUrl, src.bookSourceUrl);
      content = await contentStage(src, chUrl);
    }
  }
  return { name: s.name, search, toc, content };
}

/** 批量跑某阶段函数，带进度 */
async function runStage<T>(sources: Array<{ name: string; json: string }>, label: string, fn: (s: { name: string; json: string }) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  const CHUNK = 30;
  for (let i = 0; i < sources.length; i += CHUNK) {
    const rs = await Promise.allSettled(sources.slice(i, i + CHUNK).map(fn));
    out.push(...rs.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<T>).value));
    console.log(`${label} 进度 ${Math.min(i + CHUNK, sources.length)}/${sources.length}`);
  }
  return out;
}

describe.skipIf(!ENABLED)("full-chain source health check", () => {
  it("checks search → toc → content across enabled sources", async () => {
    const file = path.resolve(__dirname, "../../tmp_sources.json");
    let sources = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ name: string; json: string }>;
    if (NAME_FILTER) sources = sources.filter((s) => s.name.includes(NAME_FILTER));
    console.log(`\n全链路检查 ${sources.length} 个书源，关键词：${KEYWORD}\n`);
    // 第一轮：搜索
    const searchResults = await runStage(sources, "搜索", async (s) => {
      const src = parseBookSourceJson(s.json);
      return { name: s.name, ...(await searchStage(src, KEYWORD)) };
    });
    const searchOk = searchResults.filter((r) => r.res.ok).map((r) => r.name);
    console.log(`\n=== 第一轮：搜索可用 ${searchOk.length}/${searchResults.length} ===`);
    // 第二轮：仅对搜索可用的源跑目录 → 正文（每 chunk 打印累积汇总，卡住也有数据）
    const targets = sources.filter((s) => searchOk.includes(s.name));
    const results: Array<{ name: string; search: StageResult; toc: StageResult; content: StageResult }> = [];
    const CHUNK2 = 20;
    for (let i = 0; i < targets.length; i += CHUNK2) {
      const chunk = targets.slice(i, i + CHUNK2);
      console.log(`\n--- 第二轮 chunk ${i / CHUNK2 + 1}（${chunk.map((c) => c.name).join("、")}）---`);
      const rs = await Promise.allSettled(chunk.map(checkOne));
      const done = rs.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<typeof results[number]>).value);
      for (const r of done) {
        results.push(r);
        const toc = r.toc.cls === "norule" ? "-" : r.toc.ok ? `目录OK(${r.toc.detail})` : `目录FAIL(${r.toc.cls})`;
        const content = r.content.cls === "norule" ? "-" : r.content.ok ? `正文OK(${r.content.detail})` : `正文FAIL(${r.content.cls})`;
        console.log(`  ${r.name} | ${toc} | ${content}${!r.toc.ok && r.toc.cls !== "norule" ? " | " + r.toc.detail : ""}${!r.content.ok && r.content.cls !== "norule" ? " | " + r.content.detail : ""}`);
      }
      const withTocRule = results.filter((r) => r.toc.cls !== "norule");
      const tocOk = withTocRule.filter((r) => r.toc.ok);
      const withContentRule = results.filter((r) => r.content.cls !== "norule");
      const contentOk = withContentRule.filter((r) => r.content.ok);
      console.log(`进度 ${Math.min(i + CHUNK2, targets.length)}/${targets.length}：目录可用 ${tocOk.length}/${withTocRule.length}，正文可用 ${contentOk.length}/${withContentRule.length}`);
    }
    const withTocRule = results.filter((r) => r.toc.cls !== "norule");
    const tocOk = withTocRule.filter((r) => r.toc.ok);
    const tocFail = withTocRule.filter((r) => !r.toc.ok);
    const withContentRule = results.filter((r) => r.content.cls !== "norule");
    const contentOk = withContentRule.filter((r) => r.content.ok);
    const contentFail = withContentRule.filter((r) => !r.content.ok);
    console.log(`\n=== 汇总 ===`);
    console.log(`搜索可用：${searchOk.length}/${sources.length}`);
    console.log(`目录：有规则 ${withTocRule.length}，可用 ${tocOk.length}，失败 ${tocFail.length}`);
    console.log(`正文：有规则 ${withContentRule.length}，可用 ${contentOk.length}，失败 ${contentFail.length}`);
    const tocNet = tocFail.filter((r) => r.toc.cls === "network").length;
    const tocEmpty = tocFail.filter((r) => r.toc.cls === "empty").length;
    const contentNet = contentFail.filter((r) => r.content.cls === "network").length;
    const contentEmpty = contentFail.filter((r) => r.content.cls === "empty").length;
    console.log(`\n=== 目录环节失败分类（${tocFail.length}）：网络 ${tocNet}，提取为空 ${tocEmpty} ===`);
    for (const r of tocFail.slice(0, 25)) console.log(`  ${r.name}: ${r.toc.cls} - ${r.toc.detail}`);
    console.log(`\n=== 正文环节失败分类（${contentFail.length}）：网络 ${contentNet}，提取为空 ${contentEmpty} ===`);
    for (const r of contentFail.slice(0, 25)) console.log(`  ${r.name}: ${r.content.cls} - ${r.content.detail}`);
    expect(results.length).toBe(targets.length);
  }, 1800000);
});
