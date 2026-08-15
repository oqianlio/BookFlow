import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { searchBookSources } from "./searchService";

vi.mock("./api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

beforeEach(() => vi.clearAllMocks());

const srcJson = (name: string) => JSON.stringify({
  bookSourceUrl: `https://${name}.com`, bookSourceName: name,
  searchUrl: `https://${name}.com/search?q={{key}}`,
  ruleSearch: { bookList: "ul>li", name: "h3@text", author: "p@text", bookUrl: "a@href" },
});

const hitHtml = (title: string, author: string, href: string) =>
  `<html><body><ul><li><h3>${title}</h3><p>${author}</p><a href="${href}">链接</a></li></ul></body></html>`;

describe("searchBookSources", () => {
  it("searches across all enabled sources and aggregates hits", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) =>
      url.startsWith("https://a.com")
        ? hitHtml("三体", "刘慈欣", "/a/1.html")
        : hitHtml("三体", "刘慈欣", "/b/2.html"),
    );
    const hits = await searchBookSources("三体");
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.sourceName).sort()).toEqual(["源A", "源B"]);
    expect(hits[0].bookUrl).toMatch(/^https?:\/\//);
  });

  it("filters to the given sourceIds (exclude current source)", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(hitHtml("三体", "刘慈欣", "/x/1.html"));
    const hits = await searchBookSources("三体", { sourceIds: [2] });
    expect(api.httpGet).toHaveBeenCalledTimes(1);
    expect(hits[0].sourceName).toBe("源B");
  });

  it("degrades gracefully when a single source fails", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "源A", url: "https://a.com", json: srcJson("a"), enabled: true, last_used_at: null },
      { id: 2, name: "源B", url: "https://b.com", json: srcJson("b"), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url.startsWith("https://a.com")) throw new Error("网络错误");
      return hitHtml("三体", "刘慈欣", "/b/2.html");
    });
    const hits = await searchBookSources("三体");
    expect(hits.length).toBe(1);
    expect(hits[0].sourceName).toBe("源B");
  });
});
