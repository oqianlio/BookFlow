import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LibraryPage from "./LibraryPage";
import * as api from "../services/api";

const books = [
  { id: 1, title: "三体", format: "epub", path: "b1.epub", cover_path: null, added_at: 1, last_opened_at: null },
  { id: 2, title: "算法导论", format: "pdf", path: "b2.pdf", cover_path: null, added_at: 2, last_opened_at: null },
];

const shelfSource = {
  id: 9, source_id: 3, source_name: "示例", book_url: "https://ex.com/b/1.html",
  title: "球状闪电", author: "刘慈欣", cover_url: null, added_at: 3, last_opened_at: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([]);
});

describe("LibraryPage", () => {
  it("renders book cards and empty state", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("算法导论")).toBeInTheDocument();
  });

  it("calls importFiles on import click", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    const spy = vi.spyOn(api, "importFiles").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("书架空空如也，点击导入书籍");
    await userEvent.click(screen.getByRole("button", { name: /导入书籍/ }));
    expect(spy).toHaveBeenCalled();
  });

  it("shows empty state when no books", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
  });

  it("toggles the full-text search panel", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText(/书架空空如也/);
    await userEvent.click(screen.getByRole("button", { name: /全文搜索/ }));
    expect(screen.getByPlaceholderText("搜索书名与正文")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /全文搜索/ }));
    expect(screen.queryByPlaceholderText("搜索书名与正文")).not.toBeInTheDocument();
  });

  it("renders local and source books together", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("球状闪电")).toBeInTheDocument();
    expect(screen.getByText("示例")).toBeInTheDocument();
  });

  it("opens a source book via onOpenSourceBook", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const onOpenSourceBook = vi.fn();
    render(<LibraryPage onOpenBook={() => {}} onOpenSourceBook={onOpenSourceBook} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开 球状闪电" }));
    expect(onOpenSourceBook).toHaveBeenCalledWith(shelfSource);
  });

  it("removes a source book from the shelf", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const spy = vi.spyOn(api, "removeShelfSourceBook").mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LibraryPage onOpenBook={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "删除 球状闪电" }));
    expect(spy).toHaveBeenCalledWith(9);
    confirmSpy.mockRestore();
  });
});
