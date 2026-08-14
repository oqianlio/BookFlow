import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage, { computeStats } from "./HomePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({ listBooks: vi.fn(), importFiles: vi.fn() }));

const now = 1_700_000_000;

const books = [
  { id: 1, title: "三体", format: "epub", path: "a.epub", cover_path: null, added_at: 1, last_opened_at: now - 3600 },
  { id: 2, title: "算法", format: "pdf", path: "b.pdf", cover_path: null, added_at: 2, last_opened_at: now - 10 * 86400 },
  { id: 3, title: "旧书", format: "epub", path: "c.epub", cover_path: null, added_at: 3, last_opened_at: null },
];

describe("computeStats", () => {
  it("counts total, formats, and last-7-day opens", () => {
    const s = computeStats(books, now);
    expect(s.total).toBe(3);
    expect(s.byFormat).toEqual([{ format: "epub", count: 2 }, { format: "pdf", count: 1 }]);
    expect(s.openedLast7).toBe(1);
  });
});

describe("HomePage", () => {
  it("renders stats and quick actions, no book cards", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    render(<HomePage />);
    expect(await screen.findByText("3")).toBeInTheDocument();  // 藏书统计
    expect(screen.getByText("EPUB")).toBeInTheDocument();       // 格式统计
    expect(screen.getByRole("button", { name: /导入书籍/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去书架/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去发现/ })).toBeInTheDocument();
    // 不再渲染最近阅读书卡
    expect(screen.queryByText("三体")).not.toBeInTheDocument();
    expect(screen.queryByText("算法")).not.toBeInTheDocument();
  });

  it("shows empty state when no books", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    render(<HomePage />);
    expect(await screen.findByText(/书架空空/)).toBeInTheDocument();
  });

  it("calls importFiles and refreshes on 导入书籍 click", async () => {
    vi.mocked(api.listBooks).mockResolvedValueOnce([]).mockResolvedValueOnce(books);
    vi.mocked(api.importFiles).mockResolvedValue(books as any);
    render(<HomePage />);
    await screen.findByText(/书架空空/);
    await userEvent.click(screen.getByRole("button", { name: /导入书籍/ }));
    expect(api.importFiles).toHaveBeenCalled();
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("navigates to bookshelf and discover via quick buttons", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    const goShelf = vi.fn();
    const goDiscover = vi.fn();
    render(<HomePage onGoBookshelf={goShelf} onGoDiscover={goDiscover} />);
    await screen.findByText(/书架空空/);
    await userEvent.click(screen.getByRole("button", { name: /去书架/ }));
    expect(goShelf).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /去发现/ }));
    expect(goDiscover).toHaveBeenCalled();
  });
});
