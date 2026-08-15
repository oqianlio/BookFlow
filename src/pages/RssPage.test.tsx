import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RssPage from "./RssPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listRssFeeds: vi.fn(),
  listRssArticles: vi.fn(),
  addRssFeed: vi.fn(),
  deleteRssFeed: vi.fn(),
  refreshRssFeed: vi.fn(),
}));

const feeds = [
  { id: 1, title: "科技日报", url: "https://ex.com/rss.xml", site_url: null, added_at: 1 },
];
const articles = [
  { id: 10, feed_id: 1, guid: "g1", title: "文章甲", link: "https://ex.com/a1", content: "<p>内容</p>", published_at: 1704067200, fetched_at: 1 },
];

beforeEach(() => vi.clearAllMocks());

describe("RssPage", () => {
  it("lists feeds and articles for the active feed", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue(articles);
    render(<RssPage onOpenArticle={() => {}} />);
    expect(await screen.findByText("科技日报")).toBeInTheDocument();
    expect(await screen.findByText("文章甲")).toBeInTheDocument();
  });

  it("adds a feed and selects it", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue([]);
    vi.mocked(api.addRssFeed).mockResolvedValue(2);
    render(<RssPage onOpenArticle={() => {}} />);
    await screen.findByText("科技日报");
    fireEvent.change(screen.getByLabelText("订阅源地址"), { target: { value: "https://ex.com/new.xml" } });
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(api.addRssFeed).toHaveBeenCalledWith("https://ex.com/new.xml");
  });

  it("deletes a feed after confirm", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RssPage onOpenArticle={() => {}} />);
    await screen.findByText("科技日报");
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(api.deleteRssFeed).toHaveBeenCalledWith(1);
  });

  it("opens an article via onOpenArticle", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue(articles);
    const onOpenArticle = vi.fn();
    render(<RssPage onOpenArticle={onOpenArticle} />);
    await userEvent.click(await screen.findByText("文章甲"));
    expect(onOpenArticle).toHaveBeenCalledWith(articles[0]);
  });
});
