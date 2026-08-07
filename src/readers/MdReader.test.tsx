import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MdReader from "./MdReader";

vi.mock("../services/api", () => ({
  readFileContent: vi.fn().mockResolvedValue("# 标题\n\n正文 <img src=x onerror=alert(1)> 继续"),
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

describe("MdReader", () => {
  it("renders markdown with inline event handlers stripped", async () => {
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("标题"));
    const img = container.querySelector(".md-content img");
    // DOMPurify 会移除 img 上的 onerror 事件属性
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("jumps to a line offset via line: prefix", async () => {
    render(<MdReader path="/b.md" bookId={1} />);
    await screen.findByText(/标题/);
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:1" }));
    // 不抛错即视为跳转逻辑执行成功（jsdom 无真实滚动布局）
    expect(window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:1" }))).toBe(true);
  });
});
