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
  markRssArticleRead: vi.fn(),
  markRssFeedRead: vi.fn(),
  rssUnreadCount: vi.fn(),
  exportRssOpml: vi.fn(),
  importRssOpml: vi.fn(),
}));

const feeds = [
  { id: 1, title: "科技日报", url: "https://ex.com/rss.xml", site_url: null, added_at: 1 },
];
const articles = [
  { id: 10, feed_id: 1, guid: "g1", title: "文章甲", link: "https://ex.com/a1", content: "<p>内容</p>", published_at: 1704067200, fetched_at: 1, is_read: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.rssUnreadCount).mockResolvedValue(0);
  vi.mocked(api.markRssArticleRead).mockResolvedValue(undefined);
  vi.mocked(api.markRssFeedRead).mockResolvedValue(undefined);
  vi.mocked(api.exportRssOpml).mockResolvedValue("<opml></opml>");
  vi.mocked(api.importRssOpml).mockResolvedValue(2);
});

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

  it("deletes a feed after confirming", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue([]);
    render(<RssPage onOpenArticle={() => {}} />);
    await screen.findByText("科技日报");
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    // 自定义确认框：确定后执行删除
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
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

  it("marks unread article as read when opened", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.rssUnreadCount).mockResolvedValue(1);
    vi.mocked(api.listRssArticles).mockResolvedValue(articles);
    const onOpenArticle = vi.fn();
    render(<RssPage onOpenArticle={onOpenArticle} />);
    await screen.findByText("科技日报");
    // 未读徽标
    expect(await screen.findByText("1")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("文章甲"));
    expect(api.markRssArticleRead).toHaveBeenCalledWith(10, true);
    expect(onOpenArticle).toHaveBeenCalledWith(articles[0]);
  });

  it("marks the whole feed read", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue(feeds);
    vi.mocked(api.listRssArticles).mockResolvedValue(articles);
    render(<RssPage onOpenArticle={() => {}} />);
    await screen.findByText("科技日报");
    await userEvent.click(screen.getByRole("button", { name: "全部已读" }));
    expect(api.markRssFeedRead).toHaveBeenCalledWith(1);
  });

  it("exports OPML on button click", async () => {
    vi.mocked(api.listRssFeeds).mockResolvedValue([]);
    render(<RssPage onOpenArticle={() => {}} />);
    await screen.findByText(/暂无订阅源/);
    await userEvent.click(screen.getByRole("button", { name: "导出 OPML" }));
    expect(api.exportRssOpml).toHaveBeenCalled();
  });
});
