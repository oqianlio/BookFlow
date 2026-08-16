import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifySource, verifySources, failureGroup, updateSourceGroups, invalidGroupNames, isInvalidGroup,
} from "./sourceVerify";
import * as api from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    httpGet: vi.fn(),
    updateBookSource: vi.fn().mockResolvedValue(undefined),
  };
});

const bs = (id: number, name: string, json: string, enabled = true) => ({
  id, name, url: "", json, enabled, last_used_at: null,
});

const okJson = (extra: Record<string, unknown> = {}) => JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试", searchUrl: "/search?q={{key}}",
  ruleSearch: { bookList: ".bookbox", name: ".bookname a@text" },
  ...extra,
});

describe("failureGroup / group helpers", () => {
  it("classifies reasons into legado group names", () => {
    expect(failureGroup("无搜索URL")).toBe("搜索链接规则为空");
    expect(failureGroup("搜索链接规则为空")).toBe("搜索链接规则为空");
    expect(failureGroup("AbortError: This operation was aborted")).toBe("校验超时");
    expect(failureGroup("timed out")).toBe("校验超时");
    expect(failureGroup("无结果")).toBe("搜索失效");
    expect(failureGroup("ReferenceError: x is not defined")).toBe("js失效");
    expect(failureGroup("TypeError: fetch failed")).toBe("网站失效");
    expect(failureGroup("HTTP 403")).toBe("网站失效");
  });

  it("isInvalidGroup matches legado getInvalidGroupNames", () => {
    expect(isInvalidGroup("搜索失效")).toBe(true);
    expect(isInvalidGroup("网站失效")).toBe(true);
    expect(isInvalidGroup("校验超时")).toBe(true);
    expect(isInvalidGroup("搜索正文失效")).toBe(true);
    expect(isInvalidGroup("小说")).toBe(false);
  });

  it("updateSourceGroups adds failure group and removes stale failure markers", () => {
    const json = okJson({ bookSourceGroup: "小说,搜索失效" });
    const out = JSON.parse(updateSourceGroups(json, "网站失效"));
    expect(out.bookSourceGroup).toBe("小说,网站失效");
  });

  it("updateSourceGroups removes all failure markers on success", () => {
    const json = okJson({ bookSourceGroup: "小说,搜索失效,校验超时" });
    const out = JSON.parse(updateSourceGroups(json, null));
    expect(out.bookSourceGroup).toBe("小说");
  });

  it("updateSourceGroups preserves non-failure groups and is idempotent", () => {
    const json = okJson({ bookSourceGroup: "小说" });
    const out = JSON.parse(updateSourceGroups(json, "搜索失效"));
    expect(out.bookSourceGroup).toBe("小说,搜索失效");
    // 再次失败同标记不重复
    const out2 = JSON.parse(updateSourceGroups(JSON.stringify(out), "搜索失效"));
    expect(out2.bookSourceGroup).toBe("小说,搜索失效");
  });

  it("invalidGroupNames extracts failure groups from json", () => {
    expect(invalidGroupNames(okJson({ bookSourceGroup: "小说,网站失效,校验超时" }))).toEqual(["网站失效", "校验超时"]);
    expect(invalidGroupNames(okJson({ bookSourceGroup: "小说" }))).toEqual([]);
    expect(invalidGroupNames("not json")).toEqual([]);
  });
});

describe("sourceVerify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a source ok with result count when search returns items", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body>
      <ul class="bookbox"><li class="bookname"><a href="/1.html">我的</a></li></ul>
    </body></html>`);
    const src = bs(1, "好源", okJson());
    const r = await verifySource(src);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.group).toBeNull();
    // 默认关键字 "我的"（原版 CheckSource.keyword）
    expect(api.httpGet).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(api.httpGet).mock.calls[0][0])).toContain(encodeURIComponent("我的"));
  });

  it("uses ruleSearch.checkKeyWord to override the keyword (legado getCheckKeyword)", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(`<html><body>
      <ul class="bookbox"><li class="bookname"><a href="/1.html">斗破苍穹</a></li></ul>
    </body></html>`);
    const src = bs(1, "定制", okJson({ ruleSearch: { bookList: ".bookbox", name: ".bookname a@text", checkKeyWord: "斗破苍穹" } }));
    await verifySource(src);
    expect(String(vi.mocked(api.httpGet).mock.calls[0][0])).toContain(encodeURIComponent("斗破苍穹"));
  });

  it("marks a source failed with failure group when search returns no matching items", async () => {
    vi.mocked(api.httpGet).mockResolvedValue("<html><body><main><p>这里是页面主体内容</p><p>没有搜索到相关的内容，请更换关键词重试一下看看</p></main></body></html>");
    const src = bs(2, "坏源", okJson());
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("无结果");
    expect(r.group).toBe("搜索失效");
  });

  it("reports 无搜索URL for sources without searchUrl", async () => {
    const src = bs(3, "无URL", JSON.stringify({ bookSourceUrl: "https://ex.com", bookSourceName: "测试" }));
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("无搜索URL");
    expect(r.group).toBe("搜索链接规则为空");
    expect(api.httpGet).not.toHaveBeenCalled();
  });

  it("reports network errors as failure reason", async () => {
    vi.mocked(api.httpGet).mockRejectedValue(new Error("HTTP 403"));
    const src = bs(4, "封禁", okJson());
    const r = await verifySource(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("HTTP 403");
    expect(r.group).toBe("网站失效");
  });

  it("verifySources runs concurrently and reports progress in order", async () => {
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      await new Promise((res) => setTimeout(res, String(url).includes("s1") ? 30 : 5));
      return '<html><body><ul class="bookbox"><li class="bookname"><a href="/a.html">我的</a></li></ul></body></html>';
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

  it("persists failure group marker via updateBookSource (legado update after check)", async () => {
    vi.mocked(api.httpGet).mockResolvedValue("<html><body><main><p>这里是页面主体内容</p><p>没有搜索到相关的内容，请更换关键词重试一下看看</p></main></body></html>");
    const json = okJson();
    const src = bs(5, "失败源", json);
    await verifySources([src], { concurrency: 1 });
    expect(api.updateBookSource).toHaveBeenCalledTimes(1);
    const [, , , updatedJson] = vi.mocked(api.updateBookSource).mock.calls[0];
    expect(JSON.parse(String(updatedJson)).bookSourceGroup).toContain("搜索失效");
  });

  it("does not persist when json is unchanged (ok source without stale markers)", async () => {
    vi.mocked(api.httpGet).mockResolvedValue('<html><body><ul class="bookbox"><li class="bookname"><a href="/a.html">我的</a></li></ul></body></html>');
    const src = bs(6, "好源", okJson());
    await verifySources([src], { concurrency: 1 });
    expect(api.updateBookSource).not.toHaveBeenCalled();
  });

  it("verifySources respects shouldCancel", async () => {
    vi.mocked(api.httpGet).mockResolvedValue('<html><body><ul class="bookbox"><li>我的</li></ul></body></html>');
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
