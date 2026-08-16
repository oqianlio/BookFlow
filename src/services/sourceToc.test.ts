import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { fetchToc, clearTocCache, applyInitResult } from "./sourceToc";

vi.mock("./api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href" },
});

const bookHtml = `<html><body><h1>三体</h1><span class="author">刘慈欣</span><ol>
  <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;

beforeEach(() => { vi.clearAllMocks(); clearTocCache(); });

describe("fetchToc", () => {
  it("fetches book info and toc list", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    const r = await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(r.info.title).toBe("三体");
    expect(r.info.author).toBe("刘慈欣");
    expect(r.toc.map((t) => t.name)).toEqual(["第一章", "第二章"]);
    expect(r.toc[0].url).toBe("https://ex.com/c/1.html");
  });

  it("caches the result per source+book and does not re-request", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(api.httpGet).toHaveBeenCalledTimes(1);
  });

  it("uses a separate cache entry for a different book", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml);
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/2.html", initialTitle: "球状闪电" });
    expect(api.httpGet).toHaveBeenCalledTimes(2);
  });

  it("throws when the source is missing", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    await expect(fetchToc({ sourceId: 99, bookUrl: "https://ex.com/b.html", initialTitle: "x" }))
      .rejects.toThrow("书源不存在");
  });

  it("throws when httpGet fails and does not cache the failure", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockRejectedValueOnce(new Error("网络错误")).mockResolvedValueOnce(bookHtml);
    await expect(fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" }))
      .rejects.toThrow("网络错误");
    const r = await fetchToc({ sourceId: 1, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(r.toc.length).toBe(2);
  });

  it("follows nextTocUrl pagination and merges chapters with dedup", async () => {
    const pagedSource = JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "分页",
      ruleToc: {
        chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href",
        nextTocUrl: ".next@href",
      },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 2, name: "分页", url: "https://ex.com", json: pagedSource, enabled: true, last_used_at: null },
    ]);
    const page1 = `<html><body><ol><li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol>
      <a class="next" href="/toc/2.html">下一页</a></body></html>`;
    const page2 = `<html><body><ol><li><a href="/c/2.html">第二章</a></li><li><a href="/c/3.html">第三章</a></li></ol>
      <a class="next" href="/toc/1.html">上一页</a></body></html>`;
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/toc/2.html")) return page2;
      return page1;
    });
    const r = await fetchToc({ sourceId: 2, bookUrl: "https://ex.com/book/1.html", initialTitle: "x" });
    expect(r.toc.map((t) => t.name)).toEqual(["第一章", "第二章", "第三章"]);
    expect(r.toc[2].url).toBe("https://ex.com/c/3.html");
  });

  it("stops pagination when nextTocUrl extraction is empty", async () => {
    const pagedSource = JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "单页",
      ruleToc: {
        chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href",
        nextTocUrl: ".next@href",
      },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 3, name: "单页", url: "https://ex.com", json: pagedSource, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml); // 无 .next 链接
    const r = await fetchToc({ sourceId: 3, bookUrl: "https://ex.com/book/1.html", initialTitle: "x" });
    expect(r.toc.length).toBe(2);
    expect(api.httpGet).toHaveBeenCalledTimes(1);
  });

  it("falls back to the book page when tocUrl rule extracts empty (no empty URL request)", async () => {
    // 错层小说场景：tocUrl 规则"查看全部章节"在页面不存在 → 提取空 → 回退书页，不发起空 URL 请求
    const src = JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "错层",
      ruleBookInfo: { tocUrl: ".toc-link@href" },
      ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href" },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 4, name: "错层", url: "https://ex.com", json: src, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(bookHtml); // 页面无 .toc-link
    const r = await fetchToc({ sourceId: 4, bookUrl: "https://ex.com/book/1.html", initialTitle: "三体" });
    expect(r.toc.length).toBe(2);
    // 只请求一次（书页本身），绝不请求空 URL
    expect(api.httpGet).toHaveBeenCalledTimes(1);
    expect(api.httpGet).toHaveBeenCalledWith("https://ex.com/book/1.html", undefined, undefined, undefined, undefined, undefined, "ex.com");  });

  it("applies init rule for JSON sources (南极 bookInfo pattern)", async () => {
    // ruleBookInfo.init = $.data.bookInfo：书名/作者/tocUrl 相对子对象提取
    const src = JSON.stringify({
      bookSourceUrl: "https://so.html5.qq.com", bookSourceName: "南极",
      ruleBookInfo: {
        init: "$.data.bookInfo",
        name: "$.resourceName",
        tocUrl: "https://bookshelf.html5.qq.com/qbread/api/book/all-chapter?bookId={{$.resourceID}}",
      },
      ruleToc: { chapterList: "$.rows", chapterName: "$.serialName", chapterUrl: "$.serialID" },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 5, name: "南极", url: "https://so.html5.qq.com", json: src, enabled: true, last_used_at: null },
    ]);
    const bookInfo = JSON.stringify({
      data: { bookInfo: { resourceID: "1100474235", resourceName: "吞噬星空" } },
    });
    const allChapter = JSON.stringify({
      rows: [{ serialID: 1, serialName: "第一章 陨石" }, { serialID: 2, serialName: "第二章 罗峰" }],
    });
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("bookInfo")) return bookInfo;
      if (u.includes("all-chapter")) return allChapter;
      return "{}";
    });
    const r = await fetchToc({ sourceId: 5, bookUrl: "https://novel.html5.qq.com/qbread/api/novel/bookInfo?resourceId=1100474235", initialTitle: "吞噬星空" });
    expect(r.info.title).toBe("吞噬星空");
    // tocUrl 模板 {{$.resourceID}} 在 init 后能提取到 → 请求 all-chapter API
    expect(api.httpGet).toHaveBeenCalledWith(
      expect.stringContaining("all-chapter?bookId=1100474235"),
      undefined, undefined, undefined, undefined, undefined, "so.html5.qq.com",
    );
    expect(r.toc.map((t) => t.name)).toEqual(["第一章 陨石", "第二章 罗峰"]);
    // 相对 URL 会按 all-chapter 基址解析
    expect(r.toc[0].url).toContain("book/1");
  });

  it("applyInitResult returns sub-object JSON for init path", () => {
    const result = JSON.stringify({ data: { bookInfo: { name: "x" } } });
    expect(applyInitResult("$.data.bookInfo", result)).toBe(JSON.stringify({ name: "x" }));
    // 非 JSON 或路径无效原样返回
    expect(applyInitResult("$.x", "not json")).toBe("not json");
    expect(applyInitResult(undefined, result)).toBe(result);
  });
});
