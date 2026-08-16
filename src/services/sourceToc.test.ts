import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { fetchToc, clearTocCache } from "./sourceToc";

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
});
