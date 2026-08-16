import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("routes a jumpTo location to the reader via reader-jump", async () => {
    const listener = vi.fn();
    window.addEventListener("reader-jump", listener);
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} jumpTo="line:120" />);
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect((window as any).__jumpTo).toBe("line:120");
    window.removeEventListener("reader-jump", listener);
  });

  it("does not jump without a jumpTo prop", async () => {
    const listener = vi.fn();
    window.addEventListener("reader-jump", listener);
    render(<ReaderPage source={{ kind: "local", book: { ...book, format: "pdf" } }} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("reader-jump", listener);
  });

  it("injects reading settings CSS variables for local books", async () => {
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
    const main = document.querySelector(".reader-main") as HTMLElement;
    await waitFor(() => {
      expect(main.style.getPropertyValue("--read-font-size")).toBe("18px");
      expect(main.style.getPropertyValue("--read-line-height")).toBe("1.8");
    });
    expect(main.style.background).toBeTruthy();   // activeTheme.bg（纸白）
    expect(main.getAttribute("data-bg-theme")).toBe("paper");
  });

  it("opens reading settings for local books (no page-mode group)", async () => {
    render(<ReaderPage source={{ kind: "local", book }} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /设置/ }));
    expect(await screen.findByText("阅读设置")).toBeInTheDocument();
    expect(screen.getByLabelText("字号")).toBeInTheDocument();
    // 本地书隐藏书源专属的翻页模式
    expect(screen.queryByRole("group", { name: "翻页模式" })).not.toBeInTheDocument();
    // 改字号 → main 变量更新
    await userEvent.click(screen.getByLabelText("字号"));
    fireEvent.change(screen.getByLabelText("字号"), { target: { value: "20" } });
    const main = document.querySelector(".reader-main") as HTMLElement;
    await waitFor(() => expect(main.style.getPropertyValue("--read-font-size")).toBe("20px"));
  });
});
