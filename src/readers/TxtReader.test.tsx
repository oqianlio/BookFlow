import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TxtReader from "./TxtReader";
import { readFileContent } from "../services/api";
import { clearLocalTextCache } from "../services/localBookCache";

vi.mock("../services/api", () => ({
  readFileContent: vi.fn().mockResolvedValue(Array.from({ length: 80 }, (_, i) => `行${i}`).join("\n")),
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => { vi.clearAllMocks(); clearLocalTextCache(); });

describe("TxtReader", () => {
  it("jumps to a page on reader-jump event", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "1" }));
    expect(await screen.findByText(/2 \/ 2/)).toBeInTheDocument();
  });

  it("jumps from a search line offset (line:N) to the right page", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    // 第 60 行落在第 2 页（每页 40 行）
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:60" }));
    expect(await screen.findByText(/2 \/ 2/)).toBeInTheDocument();
  });

  it("publishes current page as __readerLocation", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    expect((window as any).__readerLocation).toBe("0");
  });

  it("applies a jump received before content loads once the page count is known", async () => {
    let resolveRead!: (v: string) => void;
    vi.mocked(readFileContent).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    render(<TxtReader path="/b.txt" bookId={1} />);
    expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument();
    // 内容未加载时到达的搜索跳转：先缓存，不丢失到第 0 页
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:60" }));
    await waitFor(() => expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument());
    resolveRead(Array.from({ length: 80 }, (_, i) => `行${i}`).join("\n"));
    // 内容就绪后落到第 2 页（每页 40 行）
    expect(await screen.findByText(/2 \/ 2/)).toBeInTheDocument();
  });
});
