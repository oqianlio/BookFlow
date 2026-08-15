import { describe, it, expect } from "vitest";
import { parseHtml, extractList, parseSearchUrl } from "./bookSourceEngine";

// 说明：vitest 无法调用 Tauri command（Rust 传输层 http_get），故此处用 node fetch 直连真实站点，
// 仅覆盖 JS 规则引擎（parseHtml/extractList/parseSearchUrl）；Rust 传输层的默认 UA/headers 行为
// 由 Rust 侧单元测试覆盖。网络用例一律「只跳过、永不硬失败」：请求异常与非 2xx 均走 ctx.skip()。
const BIQUMO = {
  bookSourceUrl: "https://www.biqumo.com",
  searchUrl: "https://www.biqumo.com/search.html,{\"method\":\"POST\",\"body\":\"s={{key}}\"}",
  ruleSearch: { bookList: "ul.book-grid.search-list > li", name: "h3 a@text", author: "p a@text", bookUrl: "h3 a@href" },
  // 目录页选择器（div.cataloglist > ul > li > a.cl-item），2026-08-09 实测匹配 biqumo 真实 DOM
  ruleToc: { chapterList: "div.cataloglist ul > li", name: "a.cl-item@text", url: "a.cl-item@href" },
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const online = typeof process !== "undefined" && !!process.env.CI === false && navigator.onLine !== false;

describe.skipIf(!online)("real source biqumo (smoke, needs network)", () => {
  it("searches and extracts books with UA header", async (ctx) => {
    const parsed = parseSearchUrl(BIQUMO.searchUrl, "斗破");
    let resp: Response;
    try {
      resp = await fetch(parsed.url, {
        method: parsed.method ?? "GET",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: parsed.body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      ctx.skip();
      return;
    }
    // 站点可达但返回错误页（反爬/限流）时跳过而非硬失败，守住「只跳过、永不硬失败」约定
    if (!resp.ok) {
      ctx.skip();
      return;
    }
    const doc = parseHtml(await resp.text());
    const hits = await extractList(doc, BIQUMO.ruleSearch.bookList, {
      name: BIQUMO.ruleSearch.name,
      author: BIQUMO.ruleSearch.author,
      bookUrl: BIQUMO.ruleSearch.bookUrl,
    }, { baseUrl: BIQUMO.bookSourceUrl });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name.length).toBeGreaterThan(0);
    expect(hits[0].bookUrl).toMatch(/^https?:\/\//);
  }, 20000);

  it("fetches a book page and extracts its toc (chapter list)", async (ctx) => {
    let resp: Response;
    try {
      resp = await fetch("https://www.biqumo.com/5097_5097045/", {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      ctx.skip();
      return;
    }
    if (!resp.ok) {
      ctx.skip();
      return;
    }
    const doc = parseHtml(await resp.text());
    const items = await extractList(doc, BIQUMO.ruleToc.chapterList, {
      name: BIQUMO.ruleToc.name,
      url: BIQUMO.ruleToc.url,
    }, { baseUrl: BIQUMO.bookSourceUrl });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name.length).toBeGreaterThan(0);
    expect(items[0].url).toMatch(/^https?:\/\//);
  }, 20000);
});
