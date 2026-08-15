import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoverPage, { groupExploreSources, groupSearchHits, toChannelCards } from "./DiscoverPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

describe("DiscoverPage", () => {
  it("searches enabled sources and lists hits", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例书源", url: "https://ex.com", json: JSON.stringify({
        bookSourceUrl: "https://ex.com", bookSourceName: "示例书源",
        searchUrl: "https://ex.com/search?q={{key}}",
        ruleSearch: { bookList: "@css:li", name: ".name@text", author: ".author@text", bookUrl: ".name@href" },
      }), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul><li><span class="name">三体</span><span class="author">刘慈欣</span><a class="name" href="/b/1.html"></a></li></ul>`,
    );
    render(<DiscoverPage onOpenBook={() => {}} />);
    await userEvent.type(screen.getByLabelText("搜索关键词"), "三体");
    await userEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText(/示例书源/)).toBeInTheDocument();
  });

  it("shows explore entry for enabled sources with exploreUrl", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "有浏览", url: "https://ex.com", json: JSON.stringify({ bookSourceUrl: "https://ex.com", bookSourceName: "有浏览", exploreUrl: "分类::/x.html" }), enabled: true, last_used_at: null },
      { id: 2, name: "无浏览", url: "https://ex2.com", json: JSON.stringify({ bookSourceUrl: "https://ex2.com", bookSourceName: "无浏览" }), enabled: true, last_used_at: null },
    ]);
    const onOpenExplore = vi.fn();
    render(<DiscoverPage onOpenBook={() => {}} onOpenExplore={onOpenExplore} />);
    await screen.findByPlaceholderText("输入书名，跨书源搜索");
    expect(await screen.findByText(/书源频道/)).toBeInTheDocument();
    expect(screen.getByText(/未分组/)).toBeInTheDocument();
  });

  it("opens a group channel via onOpenGroupExplore", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "有浏览", url: "https://ex.com", json: JSON.stringify({ bookSourceUrl: "https://ex.com", bookSourceName: "有浏览", exploreUrl: "分类::/x.html", bookSourceGroup: "小说" }), enabled: true, last_used_at: null },
    ]);
    const onOpenGroupExplore = vi.fn();
    render(<DiscoverPage onOpenBook={() => {}} onOpenExplore={() => {}} onOpenGroupExplore={onOpenGroupExplore} />);
    await screen.findByText(/书源频道/);
    await userEvent.click(screen.getByText("小说"));
    expect(onOpenGroupExplore).toHaveBeenCalledWith("小说", [{ id: 1, name: "有浏览" }]);
  });
});

describe("groupExploreSources", () => {
  it("groups explore sources by bookSourceGroup splitting multi groups", () => {
    const sources = [
      { id: 1, name: "源A", json: JSON.stringify({ bookSourceGroup: "小说" }) },
      { id: 2, name: "源B", json: JSON.stringify({ bookSourceGroup: "小说, 玄幻" }) },
      { id: 3, name: "源C", json: JSON.stringify({}) },
    ];
    const groups = groupExploreSources(sources as any);
    expect(groups.find((g) => g.group === "小说")?.sources.length).toBe(2);
    expect(groups.find((g) => g.group === "玄幻")?.sources.length).toBe(1);
    expect(groups.find((g) => g.group === "未分组")?.sources.length).toBe(1);
  });
});

describe("groupSearchHits", () => {
  it("merges same-title same-author hits across sources", () => {
    const hits = [
      { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://a.com/1", sourceId: 1, sourceName: "源A" },
      { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://b.com/1", sourceId: 2, sourceName: "源B" },
      { title: "球状闪电", author: "刘慈欣", coverUrl: "", bookUrl: "https://a.com/2", sourceId: 1, sourceName: "源A" },
    ];
    const grouped = groupSearchHits(hits);
    expect(grouped.length).toBe(2);
    expect(grouped[0].sources.length).toBe(2);
    expect(grouped[1].title).toBe("球状闪电");
  });
});

describe("toChannelCards", () => {
  it("builds cards with icon, count and representative", () => {
    const cards = toChannelCards([{ group: "📒 小说", sources: [{ id: 1, name: "源A" }, { id: 2, name: "源B" }] }]);
    expect(cards[0].icon).toBe("📒");
    expect(cards[0].count).toBe(2);
    expect(cards[0].representative).toBe("源A");
  });
});
