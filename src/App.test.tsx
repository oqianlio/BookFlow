import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
vi.mock("./services/fontFiles", () => ({ injectFontFaces: vi.fn().mockResolvedValue([]) }));
vi.mock("./services/eyeCare", () => ({
  loadEyeCare: vi.fn().mockResolvedValue({ enabled: false, start: "22:00", end: "06:00" }),
  saveEyeCare: vi.fn().mockResolvedValue(undefined),
}));
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
  listShelfGroups: vi.fn().mockResolvedValue([]),
  listShelfGroupMembers: vi.fn().mockResolvedValue([]),
  listBookLists: vi.fn().mockResolvedValue([]),
  removeShelfItems: vi.fn().mockResolvedValue([]),
  getProgress: vi.fn().mockResolvedValue(null),
  removeShelfSourceBook: vi.fn().mockResolvedValue(undefined),
  importFiles: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getTtsRate: vi.fn().mockResolvedValue(1),
  listRssFeeds: vi.fn().mockResolvedValue([]),
  listFontFiles: vi.fn().mockResolvedValue([]),
  copyFontFile: vi.fn().mockResolvedValue({ name: "F", file: "F.ttf" }),
  cacheSummary: vi.fn().mockResolvedValue({ book_count: 0, chapter_count: 0, total_bytes: 0 }),
  listCachedBooks: vi.fn().mockResolvedValue([]),
  deleteBookCache: vi.fn().mockResolvedValue(undefined),
  clearAllCache: vi.fn().mockResolvedValue(undefined),
  logFrontend: vi.fn().mockResolvedValue(undefined),
  readLogs: vi.fn().mockResolvedValue([]),
  clearLogs: vi.fn().mockResolvedValue(undefined),
  logFileSize: vi.fn().mockResolvedValue(0),
  exportDiagnostics: vi.fn().mockResolvedValue("diag"),
  getReadingSummary: vi.fn().mockResolvedValue({ total_books: 0, total_seconds: 0, today_seconds: 0, top_books: [], recent_reads: [] }),
  listRssArticles: vi.fn().mockResolvedValue([]),
  addRssFeed: vi.fn().mockResolvedValue(1),
  deleteRssFeed: vi.fn().mockResolvedValue(undefined),
  refreshRssFeed: vi.fn().mockResolvedValue(0),
  getRssArticle: vi.fn().mockResolvedValue(null),
}));

describe("App shell", () => {
  it("starts at the bookshelf and switches areas via side nav", async () => {
    render(<App />);
    // 无首页：直接进入书架
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /首页/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^书架$/ }));
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /我的/ }));
    expect(await screen.findByRole("heading", { name: "我的" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /RSS/ }));
    expect(await screen.findByText("RSS 订阅")).toBeInTheDocument();
  });

  it("navigates from discover to source explore and back", async () => {
    render(<App />);
    // 发现 → 直接点击源 → 浏览
    await userEvent.click(screen.getByRole("button", { name: /^发现$/ }));
    await screen.findByText("源A");
    await userEvent.click(screen.getByText("源A"));
    expect(await screen.findByText(/源A · 浏览/)).toBeInTheDocument();
    // 返回发现页
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("源A")).toBeInTheDocument();
  });
});
