import { describe, it, expect } from "vitest";
import { parseHtml, extractList, parseSearchUrl } from "./bookSourceEngine";

const BIQUMO = {
  bookSourceUrl: "https://www.biqumo.com",
  searchUrl: "https://www.biqumo.com/search.html,{\"method\":\"POST\",\"body\":\"s={{key}}\"}",
  ruleSearch: { bookList: "ul.book-grid.search-list > li", name: "h3 a@text", author: "p a@text", bookUrl: "h3 a@href" },
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
    const doc = parseHtml(await resp.text());
    const hits = extractList(doc, BIQUMO.ruleSearch.bookList, {
      name: BIQUMO.ruleSearch.name,
      author: BIQUMO.ruleSearch.author,
      bookUrl: BIQUMO.ruleSearch.bookUrl,
    }, { baseUrl: BIQUMO.bookSourceUrl });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name.length).toBeGreaterThan(0);
    expect(hits[0].bookUrl).toMatch(/^https?:\/\//);
  }, 20000);
});
