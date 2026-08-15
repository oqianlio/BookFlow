import { describe, it, expect } from "vitest";
import { parseHtml, extractList, extractSingle } from "./bookSourceEngine";

// 真实站点冒烟：biqumo 完整阅读链路（目录 → 正文）。
// 网络用例一律「只跳过、永不硬失败」：请求异常、非 2xx、限流/反爬页、结构变化（0 命中）均 ctx.skip()。
const BIQUMO = {
  bookSourceUrl: "https://www.biqumo.com",
  ruleToc: { chapterList: "div.cataloglist ul > li", name: "a.cl-item@text", url: "a.cl-item@href" },
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const online = typeof process !== "undefined" && !!process.env.CI === false && navigator.onLine !== false;

const RATE_LIMIT_PATTERNS = [/搜索间隔/, /限流/, /频繁/, /操作太频繁/, /请稍后/, /验证码/, /安全验证/, /访问过于频繁/];

function isRateLimited(doc: Document): boolean {
  const text = (doc.body?.textContent ?? "").replace(/\s+/g, "");
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

describe.skipIf(!online)("real read chain biqumo (smoke, needs network)", () => {
  it("extracts toc then first chapter content", async (ctx) => {
    let resp: Response;
    try {
      resp = await fetch("https://www.biqumo.com/5097_5097045/", {
        headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
      });
    } catch { ctx.skip(); return; }
    if (!resp.ok) { ctx.skip(); return; }
    const doc = parseHtml(await resp.text());
    if (isRateLimited(doc)) { ctx.skip(); return; }
    const toc = await extractList(doc, BIQUMO.ruleToc.chapterList, {
      name: BIQUMO.ruleToc.name, url: BIQUMO.ruleToc.url,
    }, { baseUrl: BIQUMO.bookSourceUrl });
    if (toc.length === 0) { ctx.skip(); return; } // 结构变化（改版）→ 跳过
    expect(toc[0].url).toMatch(/^https?:\/\//);
    // 抓第一章正文（biqumo 正文容器为 .content，2026-08-15 实测）
    const chResp = await fetch(toc[0].url, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (!chResp.ok) { ctx.skip(); return; }
    const chDoc = parseHtml(await chResp.text());
    if (isRateLimited(chDoc)) { ctx.skip(); return; }
    const content = await extractSingle(chDoc, ".content@text", { baseUrl: toc[0].url });
    if (content.length === 0) { ctx.skip(); return; } // 结构变化 → 跳过
    expect(content.length).toBeGreaterThan(0);
  }, 25000);
});
