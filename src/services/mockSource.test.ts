import { describe, it, expect } from "vitest";
import { parseHtml, extractList, extractSingle } from "../../src/services/bookSourceEngine";

const SOURCE = {
  bookSourceUrl: "http://127.0.0.1:8610",
  searchUrl: "http://127.0.0.1:8610/search?q={{key}}",
  ruleSearch: {
    bookList: "ul.book-list > li.book-item",
    name: "a.book-name@text",
    author: "span.book-author@text",
    bookUrl: "a.book-name@href",
  },
  ruleBookInfo: {
    name: "h1.book-title@text",
    author: "span.book-author@text",
    intro: "p.book-intro@text",
    tocUrl: "",
  },
  ruleToc: {
    chapterList: "ol.chapter-list > li > a.chapter",
    chapterName: "@text",
    chapterUrl: "@href",
  },
  ruleContent: { content: ".content@html" },
};

describe("mock book source end-to-end", () => {
  it("searches and resolves book URL", async () => {
    const url = SOURCE.searchUrl.replace("{{key}}", encodeURIComponent("三体"));
    const resp = await fetch(url);
    const html = await resp.text();
    const doc = parseHtml(html);
    const hits = extractList(doc, SOURCE.ruleSearch.bookList, {
      name: SOURCE.ruleSearch.name,
      author: SOURCE.ruleSearch.author,
      bookUrl: SOURCE.ruleSearch.bookUrl,
    }, { baseUrl: SOURCE.bookSourceUrl });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe("三体");
    expect(hits[0].author).toBe("刘慈欣");
    expect(hits[0].bookUrl).toContain("/book/0");
  }, 15000);

  it("fetches toc and chapters", async () => {
    const bookHtml = await (await fetch("http://127.0.0.1:8610/book/0")).text();
    const doc = parseHtml(bookHtml);
    expect(extractSingle(doc, SOURCE.ruleBookInfo.name)).toBe("三体");
    expect(extractSingle(doc, SOURCE.ruleBookInfo.author)).toBe("刘慈欣");
    const toc = extractList(doc, SOURCE.ruleToc.chapterList, {
      name: SOURCE.ruleToc.chapterName,
      url: SOURCE.ruleToc.chapterUrl,
    }, { baseUrl: "http://127.0.0.1:8610/book/0" });
    expect(toc.length).toBe(3);
    expect(toc[0].name).toBe("三体 I");
    expect(toc[0].url).toContain("/chapter/0/0");

    const chHtml = await (await fetch("http://127.0.0.1:8610" + toc[0].url.replace("http://127.0.0.1:8610", ""))).text();
    const chDoc = parseHtml(chHtml);
    const content = extractSingle(chDoc, SOURCE.ruleContent.content, { baseUrl: toc[0].url });
    expect(content).toContain("正文段落");
  }, 15000);
});
