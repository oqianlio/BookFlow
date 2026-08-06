import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BookmarkPanel from "./BookmarkPanel";
import * as api from "../services/api";

describe("BookmarkPanel", () => {
  it("refreshes the list on bookmark-changed event", async () => {
    const list = vi.spyOn(api, "listBookmarks").mockResolvedValue([]);
    render(<BookmarkPanel bookId={1} onJump={() => {}} onChanged={() => {}} />);
    await screen.findByText(/暂无书签/);
    vi.mocked(list).mockResolvedValue([
      { id: 1, book_id: 1, location: "cfi:x", label: "书签 1", created_at: 1 },
    ]);
    window.dispatchEvent(new CustomEvent("bookmark-changed"));
    expect(await screen.findByText("书签 1")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
