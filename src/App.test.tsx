import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
vi.mock("./readers/EpubReader", () => ({ default: () => <div data-testid="epub-reader" /> }));
vi.mock("./readers/PdfReader", () => ({ default: () => null }));
vi.mock("./readers/MdReader", () => ({ default: () => null }));
vi.mock("./readers/TxtReader", () => ({ default: () => null }));
vi.mock("./services/api", () => ({
  listBookSources: vi.fn().mockResolvedValue([]),
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
});
