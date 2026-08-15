// 书源健康检查：对每个启用书源执行一次真实搜索，统计能搜到书的源。
// 仅当设置 SOURCE_HEALTH=1 时运行（避免拖慢常规测试/依赖网络）。
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as api from "./api";
import { parseBookSourceJson, resolveSearchUrl, extractBookList, resolveUrl } from "./bookSourceEngine";
import { mergeUserAgent } from "./api";

const ENABLED = !!process.env.SOURCE_HEALTH;
const KEYWORD = process.env.SOURCE_KEYWORD ?? "斗破苍穹";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    httpGet: vi.fn(async (url: string, headers?: Record<string, string>, timeoutMs?: number) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs ?? 8000);
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ...(headers ?? {}),
          },
          signal: ctrl.signal,
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        try {
          return new TextDecoder("utf-8").decode(buf);
        } catch {
          return new TextDecoder("gbk").decode(buf);
        }
      } finally {
        clearTimeout(t);
      }
    }),
  };
});

async function checkOne(s: { id: number; name: string; url: string; json: string }) {
  const t0 = Date.now();
  try {
    const src = parseBookSourceJson(s.json);
    const parsed = resolveSearchUrl(src.searchUrl ?? "", KEYWORD, 1, { sourceKey: src.bookSourceUrl });
    if (!parsed.url) return { name: s.name, ok: false, count: 0, reason: "无搜索URL", ms: Date.now() - t0 };
    // 相对 searchUrl 基于书源域名解析（与 searchService 一致）
    const url = resolveUrl(parsed.url, src.bookSourceUrl);
    const html = await api.httpGet(url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), 8000);
    if (!html || html.length < 80) return { name: s.name, ok: false, count: 0, reason: "响应过短", ms: Date.now() - t0 };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = await extractBookList(doc, src.ruleSearch ?? {}, {
      baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl,
    });
    if (items.length === 0) {
      // 无结果诊断：bookList 规则原文 + 响应文本摘要（剥离标签）
      const bl = (src.ruleSearch as any)?.bookList ?? "";
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      return { name: s.name, ok: false, count: 0, reason: `无结果 | bookList="${bl}" | 响应:${text}`, ms: Date.now() - t0 };
    }
    return { name: s.name, ok: true, count: items.length, ms: Date.now() - t0 };
  } catch (e) {
    return { name: s.name, ok: false, count: 0, reason: String(e).slice(0, 160), ms: Date.now() - t0 };
  }
}

describe.skipIf(!ENABLED)("source health check", () => {
  it("checks all enabled sources with a real search", async () => {
    const file = path.resolve(__dirname, "../../tmp_sources.json");
    const sources = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ id: number; name: string; url: string; json: string }>;
    console.log(`\n检查 ${sources.length} 个书源，关键词：${KEYWORD}\n`);
    const results: any[] = [];
    const CHUNK = 30;
    for (let i = 0; i < sources.length; i += CHUNK) {
      const chunk = sources.slice(i, i + CHUNK);
      const rs = await Promise.all(chunk.map(checkOne));
      results.push(...rs);
      console.log(`进度 ${Math.min(i + CHUNK, sources.length)}/${sources.length}`);
    }
    const ok = results.filter((r) => r.ok);
    const noResult = results.filter((r) => !r.ok);
    console.log(`\n=== 汇总 ===`);
    console.log(`能搜到书：${ok.length}/${results.length}`);
    console.log(`无结果/失败：${noResult.length}`);
    console.log(`\n=== 能搜到的书源（${ok.length} 个）===`);
    for (const r of ok.sort((a, b) => b.count - a.count)) {
      console.log(`[${r.count}本] ${r.name} (${r.ms}ms)`);
    }
    console.log(`\n=== 失败/无结果的书源（前 40 个）===`);
    for (const r of noResult.slice(0, 40)) {
      console.log(`${r.name}: ${r.reason ?? "无结果"} (${r.ms}ms)`);
    }
    expect(results.length).toBe(sources.length);
  }, 300000);
});
