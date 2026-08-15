import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
vi.mock("./readers/EpubReader", () => ({ default: () => <div data-testid="epub-reader" /> }));
vi.mock("./readers/PdfReader", () => ({ default: () => null }));
vi.mock("./readers/MdReader", () => ({ default: () => null }));
vi.mock("./readers/TxtReader", () => ({ default: () => null }));
vi.mock("./services/api", () => ({
  listBookSources: vi.fn().mockResolvedValue([
    { id: 1, name: "源A", url: "https://a.com", json: JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A", exploreUrl: "分类::/x.html", bookSourceGroup: "小说" }), enabled: true, last_used_at: null },
  ]),
  httpGet: vi.fn().mockResolvedValue("<html><body></body></html>"),
  listBooks: vi.fn().mockResolvedValue([]),
  listShelfSourceBooks: vi.fn().mockResolvedValue([]),
  removeShelfSourceBook: vi.fn().mockResolvedValue(undefined),
  importFiles: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getTtsRate: vi.fn().mockResolvedValue(1),
  listRssFeeds: vi.fn().mockResolvedValue([]),
  listRssArticles: vi.fn().mockResolvedValue([]),
  addRssFeed: vi.fn().mockResolvedValue(1),
  deleteRssFeed: vi.fn().mockResolvedValue(undefined),
  refreshRssFeed: vi.fn().mockResolvedValue(0),
  getRssArticle: vi.fn().mockResolvedValue(null),
}));

describe("App shell", () => {
  it("switches areas via side nav", async () => {
    render(<App />);
    expect(await screen.findByText("你好，枕书")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /首页/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^书架$/ }));
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /我的/ }));
    expect(await screen.findByRole("heading", { name: "我的" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /RSS/ }));
    expect(await screen.findByText("RSS 订阅")).toBeInTheDocument();
  });

  it("returns step by step through group explore navigation", async () => {
    render(<App />);
    // 发现 → 分组频道 → 书源浏览
    await userEvent.click(screen.getByRole("button", { name: /^发现$/ }));
    await screen.findByText("书源频道");
    await userEvent.click(screen.getByText("小说"));
    expect(await screen.findByText(/小说 · 书源/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("源A"));
    expect(await screen.findByText(/源A · 浏览/)).toBeInTheDocument();
    // 逐级返回：浏览页 → 分组页 → 发现页
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText(/小说 · 书源/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("书源频道")).toBeInTheDocument();
  });
});
