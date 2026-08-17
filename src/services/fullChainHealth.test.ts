// 全链路书源健康检查：委托给 sourceVerify.verifySource，避免重复检测逻辑。
// sourceVerify 已实现真实链路（fetchTocBySource）+ 域名分组节流。
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { verifySource } from "./sourceVerify";
import { clearTocCache } from "./sourceToc";

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
    updateBookSource: vi.fn().mockResolvedValue(undefined),
  };
});

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

describe.skipIf(!ENABLED)("全链路书源健康检查（委托 sourceVerify）", () => {
  it("checks search → toc → content across enabled sources", async () => {
    const file = path.resolve(__dirname, "../../tmp_sources.json");
    let sources = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ name: string; json: string }>;
    if (NAME_FILTER) {
      const filters = NAME_FILTER.split(",").map((n) => n.trim()).filter(Boolean);
      sources = sources.filter((s) => filters.some((n) => s.name.includes(n)));
    }
    console.log(`\n全链路检查 ${sources.length} 个书源，关键词：${KEYWORD}\n`);

    const results: Array<{ name: string; ok: boolean; count: number; ms: number; reason: string; groups: string[] }> = [];
    const CHUNK = 10;
    for (let i = 0; i < sources.length; i += CHUNK) {
      const chunk = sources.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(chunk.map(async (s) => {
        clearTocCache();
        return verifySource({ id: 0, name: s.name, url: "", json: s.json, enabled: true, last_used_at: null }, { keyword: KEYWORD });
      }));
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) {
          const v = r.value;
          results.push(v);
          // 日志输出
          const searchMark = v.ok ? `搜索OK(${v.count}本)` : `搜索FAIL`;
          const tocMark = v.groups.includes("搜索目录失效") ? "目录FAIL" : v.groups.length === 0 ? "" : v.groups.join("/");
          const contentMark = v.groups.includes("搜索正文失效") ? "正文FAIL" : "";
          const parts = [searchMark, tocMark, contentMark].filter(Boolean);
          console.log(`  ${v.name} | ${parts.join(" | ")} | ${formatMs(v.ms)} | ${v.reason}`);
        }
      }
      console.log(`进度 ${Math.min(i + CHUNK, sources.length)}/${sources.length}`);
    }

    // 汇总
    const searchOk = results.filter((r) => r.ok);
    const tocFail = results.filter((r) => r.groups.includes("搜索目录失效"));
    const contentFail = results.filter((r) => r.groups.includes("搜索正文失效"));
    console.log(`\n=== 汇总 ===`);
    console.log(`搜索可用：${searchOk.length}/${results.length}`);
    console.log(`目录失效：${tocFail.length}（${tocFail.map((r) => r.name).slice(0, 10).join(", ")}）`);
    console.log(`正文失效：${contentFail.length}（${contentFail.map((r) => r.name).slice(0, 10).join(", ")}）`);
    expect(results.length).toBe(sources.length);
  }, 600_000);
});
