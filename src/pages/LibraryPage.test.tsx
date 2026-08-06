import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import LibraryPage from "./LibraryPage";
import * as api from "../services/api";

const books = [
  { id: 1, title: "三体", format: "epub", path: "b1.epub", cover_path: null, added_at: 1, last_opened_at: null },
  { id: 2, title: "算法导论", format: "pdf", path: "b2.pdf", cover_path: null, added_at: 2, last_opened_at: null },
];

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
});
