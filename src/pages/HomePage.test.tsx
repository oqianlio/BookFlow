import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage, { computeStats } from "./HomePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBooks: vi.fn(),
  listShelfSourceBooks: vi.fn().mockResolvedValue([]),
}));

const now = 1_700_000_000;

const books = [
  { id: 1, title: "三体", format: "epub", path: "a.epub", cover_path: null, added_at: 1, last_opened_at: now - 3600 },
  { id: 2, title: "算法", format: "pdf", path: "b.pdf", cover_path: null, added_at: 2, last_opened_at: now - 10 * 86400 },
  { id: 3, title: "旧书", format: "epub", path: "c.epub", cover_path: null, added_at: 3, last_opened_at: null },
];

const shelfSources = [
  { id: 7, source_id: 1, source_name: "源A", book_url: "https://a.com/1.html", title: "网文", author: null, cover_url: null, added_at: 4, last_opened_at: now - 60 },
];

beforeEach(() => vi.clearAllMocks());

describe("computeStats", () => {
  it("counts total, formats, and last-7-day opens", () => {
    const s = computeStats(books, now);
    expect(s.total).toBe(3);
    expect(s.byFormat).toEqual([{ format: "epub", count: 2 }, { format: "pdf", count: 1 }]);
    expect(s.openedLast7).toBe(1);
  });
});

describe("HomePage", () => {
  it("renders stats, quick actions and recently read books", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    vi.mocked(api.listShelfSourceBooks).mockResolvedValue(shelfSources);
    render(<HomePage onGoBookshelf={() => {}} onGoDiscover={() => {}} />);
    expect(await screen.findByText("3")).toBeInTheDocument();  // 藏书统计
    expect(screen.getByText("EPUB", { selector: ".stat-label" })).toBeInTheDocument();       // 格式统计
    expect(screen.getByRole("button", { name: /去书架/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去发现/ })).toBeInTheDocument();
    // 最近阅读：最近打开的本地书 + 在线书（未打开的旧书不展示）
    expect(screen.getByText("网文")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.queryByText("旧书")).not.toBeInTheDocument();
    // 导入入口只保留在书架页，首页不再重复
    expect(screen.queryByRole("button", { name: /导入书籍/ })).not.toBeInTheDocument();
  });

  it("opens a recently read book via onOpenBook", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    const onOpen = vi.fn();
    render(<HomePage onOpenBook={onOpen} />);
    await screen.findByText("三体");
    await userEvent.click(screen.getByRole("button", { name: "打开 三体" }));
    expect(onOpen).toHaveBeenCalledWith(books[0]);
  });

  it("shows empty state with a bookshelf CTA when no books", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    vi.mocked(api.listShelfSourceBooks).mockResolvedValue([]);
    const goShelf = vi.fn();
    render(<HomePage onGoBookshelf={goShelf} />);
    expect(await screen.findByText(/书架空空/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /去书架导入/ }));
    expect(goShelf).toHaveBeenCalled();
  });

  it("renders 最近阅读 and 概览 section headings", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    render(<HomePage />);
    expect(await screen.findByText("最近阅读")).toBeInTheDocument();
    expect(screen.getByText("概览")).toBeInTheDocument();
  });

  it("navigates to bookshelf and discover via quick buttons", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    const goShelf = vi.fn();
    const goDiscover = vi.fn();
    render(<HomePage onGoBookshelf={goShelf} onGoDiscover={goDiscover} />);
    await screen.findByText("3");
    await userEvent.click(screen.getByRole("button", { name: /去书架/ }));
    expect(goShelf).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /去发现/ }));
    expect(goDiscover).toHaveBeenCalled();
  });
});
