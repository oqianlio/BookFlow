import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoverPage from "./DiscoverPage";
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
    render(<DiscoverPage onBack={() => {}} onOpenBook={() => {}} />);
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
    render(<DiscoverPage onBack={() => {}} onOpenBook={() => {}} onOpenExplore={onOpenExplore} />);
    await screen.findByPlaceholderText("输入书名搜索所有已启用书源");
    expect(await screen.findByText(/浏览 有浏览/)).toBeInTheDocument();
    expect(screen.queryByText(/浏览 无浏览/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/浏览 有浏览/));
    expect(onOpenExplore).toHaveBeenCalledWith(1, "有浏览");
  });
});
