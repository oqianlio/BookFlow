import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { downloadBook } from "./chapterCache";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  mergeUserAgent: (h?: Record<string, string>, ua?: string) => (ua ? { ...(h ?? {}), "User-Agent": ua } : h),
  saveCachedChapter: vi.fn().mockResolvedValue(undefined),
  listCachedChapters: vi.fn().mockResolvedValue([]),
}));

const src = {
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  httpUserAgent: "UA",
  ruleContent: { content: "#content" },
} as any;

const toc = [
  { name: "第一章", url: "https://ex.com/c/1.html" },
  { name: "第二章", url: "https://ex.com/c/2.html" },
];

beforeEach(() => vi.clearAllMocks());

describe("downloadBook", () => {
  it("downloads all chapters and reports progress", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const onProgress = vi.fn();
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress });
    expect(r.done).toBe(2);
    expect(r.failed).toBe(0);
    expect(api.saveCachedChapter).toHaveBeenCalledTimes(2);
    expect(api.saveCachedChapter).toHaveBeenCalledWith(expect.objectContaining({
      chapterName: "第一章",
      content: expect.stringContaining("正文"),
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ done: 2, total: 2 }));
  });

  it("skips already cached chapters (resume)", async () => {
    vi.mocked(api.listCachedChapters).mockResolvedValue([
      { chapter_index: 0, chapter_url: "https://ex.com/c/1.html", chapter_name: "第一章", updated_at: 1 },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {} });
    expect(api.httpGet).toHaveBeenCalledTimes(1); // 只抓第二章
    expect(r.done).toBe(2);
  });

  it("continues when a single chapter fails", async () => {
    vi.mocked(api.listCachedChapters).mockResolvedValue([]);
    vi.mocked(api.httpGet).mockImplementation(async (options) => {
      const url = typeof options === "string" ? options : options.url;
      if (url.endsWith("1.html")) throw new Error("网络错误");
      return `<html><body><div id="content"><p>正文二</p></div></body></html>`;
    });
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {} });
    expect(r.failed).toBe(1);
    expect(r.done).toBe(1);
  });

  it("stops when cancelled", async () => {
    vi.mocked(api.listCachedChapters).mockResolvedValue([]);
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body><div id="content"><p>正文</p></div></body></html>`);
    const signal = { cancelled: true };
    const r = await downloadBook({ sourceId: 1, bookUrl: "https://ex.com/b/1.html", toc, getSrc: async () => src, onProgress: () => {}, signal });
    expect(api.httpGet).not.toHaveBeenCalled();
    expect(r.done).toBe(0);
  });
});
