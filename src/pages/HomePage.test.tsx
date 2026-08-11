import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage, { computeStats } from "./HomePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({ listBooks: vi.fn() }));

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
  it("renders stats and recent books sorted by last_opened_at", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    render(<HomePage onOpenBook={() => {}} />);
    expect(await screen.findByText("3")).toBeInTheDocument();   // total
    expect(await screen.findByText("三体")).toBeInTheDocument(); // most recent
    expect(screen.getByText("算法")).toBeInTheDocument();
  });
  it("shows empty state when no books", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    render(<HomePage onOpenBook={() => {}} />);
    expect(await screen.findByText(/书架空空/)).toBeInTheDocument();
  });
  it("opens a book when a recent book card is clicked", async () => {
    vi.mocked(api.listBooks).mockResolvedValue(books);
    const open = vi.fn();
    render(<HomePage onOpenBook={open} />);
    await screen.findByText("三体");
    await userEvent.click(screen.getByText("三体"));
    expect(open).toHaveBeenCalledWith(books[0]);
  });
  it("navigates to the bookshelf via the manage button", async () => {
    vi.mocked(api.listBooks).mockResolvedValue([]);
    const go = vi.fn();
    render(<HomePage onOpenBook={() => {}} onGoBookshelf={go} />);
    await screen.findByText(/书架空空/);
    await userEvent.click(screen.getByRole("button", { name: /管理书架/ }));
    expect(go).toHaveBeenCalled();
  });
});
