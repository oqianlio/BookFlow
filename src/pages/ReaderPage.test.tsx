import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReaderPage from "./ReaderPage";
import * as api from "../services/api";

vi.mock("../readers/EpubReader", () => ({ default: () => <div data-testid="epub-reader" /> }));
vi.mock("../readers/PdfReader", () => ({ default: () => null }));
vi.mock("../readers/MdReader", () => ({ default: () => null }));
vi.mock("../readers/TxtReader", () => ({ default: () => null }));

vi.mock("../services/api", () => ({
  addBookmark: vi.fn().mockResolvedValue(1),
  listBookmarks: vi.fn().mockResolvedValue([]),
  addAnnotation: vi.fn().mockResolvedValue(1),
  listAnnotations: vi.fn().mockResolvedValue([]),
  deleteAnnotation: vi.fn().mockResolvedValue(undefined),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const book = {
  id: 1, title: "三体", format: "epub", path: "b1.epub",
  cover_path: null, added_at: 1, last_opened_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).__jumpTo = undefined;
  (window as any).__readerLocation = undefined;
  (window as any).__bookmarkLocation = undefined;
  (window as any).__requestBookmark = undefined;
  (window as any).__searchJump = undefined;
});

describe("ReaderPage", () => {
  it("Ctrl+B creates a bookmark via the request-bookmark event", async () => {
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
    const w = window as any;
    w.__readerLocation = "cfi:base";
    w.__requestBookmark = () => {
      w.__bookmarkLocation = "cfi:ctrl-b";
      w.dispatchEvent(new CustomEvent("request-bookmark", { detail: "cfi:ctrl-b" }));
    };
    await userEvent.keyboard("{Control>}b{/Control}");
    await waitFor(() =>
      expect(api.addBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 1, location: "cfi:ctrl-b" }),
      ),
    );
  });

  it("clicking an annotation dispatches a reader-jump event", async () => {
    vi.mocked(api.listAnnotations).mockResolvedValue([
      { id: 1, book_id: 1, format: "epub", location: "cfi:anno", text: "高亮A", note: null, color: "yellow", created_at: 1 },
    ]);
    const listener = vi.fn();
    window.addEventListener("reader-jump", listener);
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /标注/ }));
    await screen.findByText("高亮A");
    await userEvent.click(screen.getByText("高亮A"));
    expect((window as any).__jumpTo).toBe("cfi:anno");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("reader-jump", listener);
  });

  it("Ctrl+B falls back to __readerLocation when no EPUB request-bookmark hook", async () => {
    render(<ReaderPage source={{ kind: "local", book: { ...book, format: "pdf" } }} onBack={() => {}} />);
    const w = window as any;
    w.__readerLocation = "7";
    w.__requestBookmark = undefined;
    await userEvent.keyboard("{Control>}b{/Control}");
    await waitFor(() =>
      expect(api.addBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 1, location: "7" }),
      ),
    );
  });

  it("routes a search-jump location to the reader via reader-jump", async () => {
    const listener = vi.fn();
    window.addEventListener("reader-jump", listener);
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
    window.dispatchEvent(new CustomEvent("search-jump", { detail: { location: "line:120", format: "txt" } }));
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect((window as any).__jumpTo).toBe("line:120");
    window.removeEventListener("reader-jump", listener);
  });

  it("applies a pending __searchJump set before mount", async () => {
    (window as any).__searchJump = { location: "3", format: "pdf" };
    const listener = vi.fn();
    window.addEventListener("reader-jump", listener);
    render(<ReaderPage source={{ kind: "local", book: { ...book, format: "pdf" } }} onBack={() => {}} />);
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect((window as any).__jumpTo).toBe("3");
    expect((window as any).__searchJump).toBeUndefined();
    window.removeEventListener("reader-jump", listener);
  });
});
