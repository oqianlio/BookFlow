import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifySource, verifySources } from "./sourceVerify";
import * as api from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    httpGet: vi.fn(),
  };
});

const bs = (id: number, name: string, json: string, enabled = true) => ({
  id, name, url: "", json, enabled, last_used_at: null,
});

describe("sourceVerify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a source ok with result count when search returns items", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body>
      <ul class="bookbox"><li class="bookname"><a href="/1.html">斗破苍穹</a></li></ul>
    </body></html>`);
    const src = bs(1, "好源", JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "测试",
      searchUrl: "/search?q={{key}}",
      ruleSearch: { bookList: ".bookbox", name: ".bookname a@text", bookUrl: ".bookname a@href" },
    }));
    const r = await verifySource(src);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.reason).toBe("");
    expect(api.httpGet).toHaveBeenCalledTimes(1);
  });

  it("marks a source failed when search returns no matching items", async () => {
    vi.mocked(api.httpGet).mockResolvedValue("<html><body><main><p>这里是页面主体内容</p><p>没有搜索到相关的内容，请更换关键词重试一下看看</p></main></body></html>");
    const src = bs(2, "坏源", JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "测试",
      searchUrl: "/search?q={{key}}",
      ruleSearch: { bookList: ".bookbox", name: ".bookname a@text" },
    }));
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("无结果");
  });

  it("reports 无搜索URL for sources without searchUrl", async () => {
    const src = bs(3, "无URL", JSON.stringify({ bookSourceUrl: "https://ex.com", bookSourceName: "测试" }));
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("无搜索URL");
    expect(api.httpGet).not.toHaveBeenCalled();
  });

  it("reports network errors as failure reason", async () => {
    vi.mocked(api.httpGet).mockRejectedValue(new Error("HTTP 403"));
    const src = bs(4, "封禁", JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "测试",
      searchUrl: "/search?q={{key}}",
      ruleSearch: { bookList: ".bookbox" },
    }));
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("HTTP 403");
  });

  it("verifySources runs concurrently and reports progress in order", async () => {
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      await new Promise((res) => setTimeout(res, url.includes("s1") ? 30 : 5));
      return '<html><body><ul class="bookbox"><li class="bookname"><a href="/a.html">斗破苍穹</a></li></ul></body></html>';
    });
    const sources = [1, 2, 3].map((i) => bs(i, `源${i}`, JSON.stringify({
      bookSourceUrl: `https://s${i}.com`, bookSourceName: `源${i}`,
      searchUrl: "/search?q={{key}}",
      ruleSearch: { bookList: ".bookbox", name: ".bookname a@text" },
    })));
    const progress: Array<[number, number]> = [];
    const results = await verifySources(sources, {
      concurrency: 3,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(results.length).toBe(3);
    expect(results.every((r) => r.ok)).toBe(true);
    // 结果保持输入顺序
    expect(results.map((r) => r.name)).toEqual(["源1", "源2", "源3"]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("verifySources respects shouldCancel", async () => {
    vi.mocked(api.httpGet).mockResolvedValue('<html><body><ul class="bookbox"><li>斗破苍穹</li></ul></body></html>');
    const sources = [1, 2, 3].map((i) => bs(i, `源${i}`, JSON.stringify({
      bookSourceUrl: `https://s${i}.com`, bookSourceName: `源${i}`,
      searchUrl: "/search?q={{key}}",
      ruleSearch: { bookList: ".bookbox" },
    })));
    let cancelled = false;
    // 未取消时全部处理完（并发 1 逐个执行）
    const results = await verifySources(sources, { concurrency: 1, shouldCancel: () => cancelled });
    expect(results.filter(Boolean).length).toBe(3);
    // 取消后不再启动新任务
    cancelled = true;
    const results2 = await verifySources(sources, { concurrency: 1, shouldCancel: () => cancelled });
    expect(results2.filter(Boolean).length).toBe(0);
  });
});
