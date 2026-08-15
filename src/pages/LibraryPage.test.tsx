import { render, screen, waitFor } from "@testing-library/react";
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
  localStorage.clear();
  vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([]);
  vi.spyOn(api, "getProgress").mockResolvedValue(null);
});

describe("LibraryPage", () => {
  it("renders book cards and empty state", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("算法导论")).toBeInTheDocument();
  });

  it("shows read progress on local book cards", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "getProgress").mockImplementation(async (id: number) => (id === 1 ? ["3", 0.42] : null));
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 网格模式：封面进度条（不显示百分比文字）
    await waitFor(() => expect(document.querySelector(".book-progress-bar")).not.toBeNull());
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
    // 列表模式：副行显示阅读百分比
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    await waitFor(() => expect(screen.getByText("42%")).toBeInTheDocument());
  });

  it("shows relative last-opened time in list mode", async () => {
    const opened = [{ ...books[0], last_opened_at: Math.floor(Date.now() / 1000) - 2 * 86400 }];
    vi.spyOn(api, "listBooks").mockResolvedValue(opened);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 网格无时间信息；切到列表显示
    expect(screen.queryByText("2 天前")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(await screen.findByText("2 天前")).toBeInTheDocument();
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
    // 网格模式：卡片无副行标签（.fmt）；列表模式才有格式/在线标记
    expect(document.querySelectorAll(".book-card .fmt").length).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(document.querySelectorAll(".book-card-list .fmt").length).toBe(3);
    expect(screen.queryByText("示例")).not.toBeInTheDocument();
  });

  it("opens a source book via onOpenSourceBook", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const onOpenSourceBook = vi.fn();
    render(<LibraryPage onOpenBook={() => {}} onOpenSourceBook={onOpenSourceBook} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开 球状闪电" }));
    expect(onOpenSourceBook).toHaveBeenCalledWith(shelfSource);
  });

  it("removes a source book from the shelf after confirming", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const spy = vi.spyOn(api, "removeShelfSourceBook").mockResolvedValue(undefined);
    render(<LibraryPage onOpenBook={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "删除 球状闪电" }));
    // 自定义确认框：确定后执行删除
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(spy).toHaveBeenCalledWith(9);
  });

  it("switches between grid and list layouts and persists the choice", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 默认网格 → 切到列表
    expect(document.querySelector(".book-grid")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(document.querySelector(".book-list")).not.toBeNull();
    expect(document.querySelectorAll(".book-card-list").length).toBe(2);
    expect(localStorage.getItem("library.layout")).toBe("list");
  });
});
