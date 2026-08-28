// 临时：验证 {{page}} 与 $.. 修复对真实源的效果（SOURCE_HEALTH=1）
import { describe, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as api from "./api";
import { parseBookSourceJson, resolveSearchUrl, extractBookList, resolveUrl, parseHtml, hostOf } from "./bookSourceEngine";
import { mergeUserAgent } from "./api";

// 猫眼看书已禁用（App 签名认证，详情/目录打不开）
const ENABLED = !!process.env.SOURCE_HEALTH;
const TARGETS = ["丁丁小说🥉", "阅友小说", "疯读极速", "南极小说（优）", "🍅 番茄小说聚合API"];

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

describe.skipIf(!ENABLED)("temp verify fixed JSON API sources", () => {
  it("searches each fixed source", async () => {
    const file = path.resolve(__dirname, "../../tmp_sources.json");
    const sources = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ name: string; json: string }>;
    for (const target of TARGETS) {
      const s = sources.find((x) => (JSON.parse(x.json) as any).bookSourceName === target);
      if (!s) { console.log(`\n== ${target}: NOT FOUND`); continue; }
      const src = parseBookSourceJson(s.json);
      try {
        const parsed = resolveSearchUrl(src.searchUrl ?? "", "斗破苍穹", 1, { sourceKey: src.bookSourceUrl, source: src });
        const url = resolveUrl(parsed.url, src.bookSourceUrl);
        const host = hostOf(src.bookSourceUrl);
        const html = await api.httpGet({ url, headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent), timeoutMs: 8000, method: parsed.method, body: parsed.body, cookieJar: host });
        const doc = parseHtml(html);
        const items = await extractBookList(doc, (src.ruleSearch ?? {}) as Record<string, string>, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl, source: src });
        console.log(`\n${target}: ${items.length > 0 ? `✅ ${items.length} 本（${items.slice(0, 3).map((i) => i.name).join("、")}）` : "❌ 仍无结果"}`);
      } catch (e) {
        console.log(`\n${target}: ❌ ${String(e).slice(0, 80)}`);
      }
    }
  }, 120000);
});
