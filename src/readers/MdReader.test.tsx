import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MdReader from "./MdReader";
import { readFileContent } from "../services/api";
import { clearLocalTextCache } from "../services/localBookCache";

vi.mock("../services/api", () => ({
  readFileContent: vi.fn().mockResolvedValue("# 标题\n\n正文 <img src=x onerror=alert(1)> 继续"),
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => { vi.clearAllMocks(); clearLocalTextCache(); vi.mocked(readFileContent).mockResolvedValue("# 标题\n\n正文 <img src=x onerror=alert(1)> 继续"); });

describe("MdReader", () => {
  it("renders markdown with inline event handlers stripped", async () => {
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("标题"));
    const img = container.querySelector(".md-content img");
    // DOMPurify 会移除 img 上的 onerror 事件属性
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("applies conversion=simp to content", async () => {
    vi.mocked(readFileContent).mockResolvedValue("# 書\n\n說話繁體");
    const { container } = render(<MdReader path="/b.md" bookId={2} conversion="simp" />);
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("书"));
    expect(container.querySelector(".md-content")?.textContent).toContain("说话");
    expect(container.querySelector(".md-content")?.textContent).not.toContain("書");
  });

  it("shows page navigation (翻页式，非滚动)", async () => {
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("标题"));
    // 页码导航存在（分页式阅读，不滚动）
    const nav = container.querySelector(".reader-slice-nav");
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toMatch(/\d+ \/ \d+/);
  });

  it("accepts a reader-jump without error", async () => {
    render(<MdReader path="/b.md" bookId={1} />);
    await screen.findByText(/标题/);
    // 分页式跳转：不抛错（jsdom 无布局时分页数为 1，跳转收敛到有效页）
    expect(() => {
      window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:1" }));
    }).not.toThrow();
  });
});
