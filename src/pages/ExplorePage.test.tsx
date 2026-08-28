import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExplorePage from "./ExplorePage";
import * as api from "../services/api";
import { resetJsLib } from "../services/jsLib";
import { resetNavCache } from "./navCache";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: vi.fn((h?: any) => h),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  exploreUrl: "玄幻::/sort/1_{{page}}.html\n都市::/sort/2_{{page}}.html",
  ruleExplore: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
});

describe("ExplorePage", () => {
  beforeEach(() => resetNavCache());

  it("renders categories and fetches books on click", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    render(<ExplorePage sourceId={1} sourceName="示例" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    expect(screen.getByText("都市")).toBeInTheDocument();
    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => expect(screen.getByText("三体")).toBeInTheDocument());
  });

  it("loads jsLib, parses @js: exploreUrl, and fetches books on click", async () => {
    resetJsLib("https://ex.com");
    const jsSourceJson = JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "示例",
      jsLib: "function GEN_EXPLORE(){ return '玄幻::/sort/1.html\\n都市::/sort/2.html'; }",
      exploreUrl: "@js:GEN_EXPLORE()",
      ruleExplore: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: jsSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    render(<ExplorePage sourceId={1} sourceName="示例" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    expect(screen.getByText("都市")).toBeInTheDocument();
    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => expect(screen.getByText("三体")).toBeInTheDocument());
  });

  it("paginates categories whose url contains {{page}}", async () => {    const paginatedJson = JSON.stringify({
      bookSourceUrl: "https://ex.com", bookSourceName: "测试",
      exploreUrl: "玄幻::/sort/1_{{page}}.html\n都市::/list/2.html",
      ruleExplore: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "测试", url: "https://ex.com", json: paginatedJson, enabled: true, last_used_at: null },
    ]);
    const get = vi.mocked(api.httpGet);
    get.mockClear();
    get.mockImplementation(async (options) => {
      const url = typeof options === "string" ? options : options.url;
      if (url.includes("sort/1_1.html")) return `<ul class="list"><li><a class="n" href="/b/p1">甲</a></li></ul>`;
      if (url.includes("sort/1_2.html")) return `<ul class="list"><li><a class="n" href="/b/p2">乙</a></li></ul>`;
      if (url.includes("list/2.html")) return `<ul class="list"><li><a class="n" href="/b/c">丙</a></li></ul>`;
      return "<ul></ul>";
    });
    render(<ExplorePage sourceId={1} sourceName="测试" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());

    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => expect(screen.getByText("甲")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url: "https://ex.com/sort/1_1.html", cookieJar: "ex.com" }));
    expect(screen.getByText("下一页")).toBeInTheDocument();

    await userEvent.click(screen.getByText("下一页"));
    await waitFor(() => expect(screen.getByText("乙")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url: "https://ex.com/sort/1_2.html", cookieJar: "ex.com" }));

    await userEvent.click(screen.getByText("都市"));
    await waitFor(() => expect(screen.getByText("丙")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url: "https://ex.com/list/2.html", cookieJar: "ex.com" }));
    expect(screen.queryByText("下一页")).not.toBeInTheDocument();
  });

  it("renders categories in the side column with active state", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    const { container } = render(<ExplorePage sourceId={1} sourceName="示例" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    // 分类在侧栏（.explore-side）内
    expect(container.querySelector(".explore-side")).not.toBeNull();
    expect(container.querySelector(".explore-main")).not.toBeNull();
    // 点击后激活态
    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => {
      const items = container.querySelectorAll(".explore-cat-item");
      expect(items[0].className).toContain("active");
    });
  });

  it("restores category selection and books after unmount/remount", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    const get = vi.mocked(api.httpGet);
    get.mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    get.mockClear();
    const first = render(<ExplorePage sourceId={1} sourceName="示例" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => expect(screen.getByText("三体")).toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(1);
    first.unmount();

    // 模拟从详情页返回：重新挂载，应恢复分类与书籍，且不再发请求
    get.mockClear();
    const second = render(<ExplorePage sourceId={1} sourceName="示例" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("三体")).toBeInTheDocument());
    expect(get).not.toHaveBeenCalled();
    await waitFor(() => {
      const items = second.container.querySelectorAll(".explore-cat-item");
      expect(items[0].className).toContain("active");
    });
    second.unmount();
  });
});
