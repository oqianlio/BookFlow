import { describe, it, expect, vi, beforeEach } from "vitest";
import { debugSource } from "./sourceDebug";
import * as api from "./api";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  listBookSources: vi.fn(),
  mergeUserAgent: vi.fn((h?: any) => h),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  searchUrl: "https://ex.com/search?q={{key}}",
  ruleSearch: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: { chapterList: "ol a", chapterName: "@text", chapterUrl: "@href" },
  ruleContent: { content: "#content@text" },
});

beforeEach(() => { vi.clearAllMocks(); });

describe("debugSource", () => {
  it("search stage extracts ruleSearch fields", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    const r = await debugSource({ json: sourceJson }, "search", "三体");
    expect(r.html.length).toBeGreaterThan(0);
    const name = r.fields.find((f) => f.name === "name");
    expect(name?.value).toBe("三体");
    const bookList = r.fields.find((f) => f.name === "bookList");
    expect(bookList?.value).toContain("三体");
  });

  it("toc stage extracts ruleBookInfo and ruleToc", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>书名</h1><span class="author">作者</span><ol><a href="/c/1">章1</a><a href="/c/2">章2</a></ol></body></html>`,
    );
    const r = await debugSource({ json: sourceJson }, "toc", "https://ex.com/book/1.html");
    const name = r.fields.find((f) => f.name === "name");
    expect(name?.value).toBe("书名");
    const chapterList = r.fields.find((f) => f.name === "chapterList");
    expect(chapterList?.value).toContain("章1");
  });

  it("content stage extracts ruleContent", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content">正文内容</div></body></html>`,
    );
    const r = await debugSource({ json: sourceJson }, "content", "https://ex.com/c/1.html");
    const content = r.fields.find((f) => f.name === "content");
    expect(content?.value).toBe("正文内容");
  });
});
