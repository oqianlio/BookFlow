import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SearchPanel from "./SearchPanel";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const hits = [
  { book_id: 1, title: "甲", format: "", text: "云上的日子十分漫长", location: "" },
];

beforeEach(() => {
  invokeMock.mockReset();
});

describe("SearchPanel", () => {
  it("searches via invoke and renders hits", async () => {
    invokeMock.mockResolvedValue(hits);
    render(<SearchPanel onJump={() => {}} />);
    await userEvent.type(screen.getByLabelText("搜索关键词"), "漫长");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("甲")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("search_books", { query: "漫长" });
  });

  it("does not search on empty query", async () => {
    render(<SearchPanel onJump={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes onJump with a snippet location on hit click", async () => {
    invokeMock.mockResolvedValue(hits);
    const onJump = vi.fn();
    render(<SearchPanel onJump={onJump} />);
    await userEvent.type(screen.getByLabelText("搜索关键词"), "漫长");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await userEvent.click(await screen.findByText("甲"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: 1, location: expect.stringContaining("漫长") }),
    );
  });
});
