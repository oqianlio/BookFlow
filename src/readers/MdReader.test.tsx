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

beforeEach(() => { vi.clearAllMocks(); clearLocalTextCache(); });

// 模拟滚动布局尺寸，使 jsdom 下的 scrollTop 可观测
function mockScrollGeometry(el: HTMLElement) {
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
}

describe("MdReader", () => {
  it("renders markdown with inline event handlers stripped", async () => {
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("标题"));
    const img = container.querySelector(".md-content img");
    // DOMPurify 会移除 img 上的 onerror 事件属性
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("jumps to a line offset via line: prefix", async () => {
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    await screen.findByText(/标题/);
    const el = container.querySelector<HTMLElement>(".md-reader");
    mockScrollGeometry(el!);
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:1" }));
    // 3 行文本：pct = 1/3，scrollTop = (1/3) * (1000-100)
    expect(el!.scrollTop).toBeCloseTo(300);
  });

  it("applies a jump received before content loads once the content is ready", async () => {
    let resolveRead!: (v: string) => void;
    vi.mocked(readFileContent).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    const { container } = render(<MdReader path="/b.md" bookId={1} />);
    const el = container.querySelector<HTMLElement>(".md-reader");
    mockScrollGeometry(el!);
    // 内容未加载时到达的跳转：先缓存，内容就绪后应用
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:1" }));
    resolveRead("# 标题\n\n正文\n\n更多内容");
    await waitFor(() => expect(container.querySelector(".md-content")?.textContent).toContain("标题"));
    // 5 行文本：pct = 1/5，scrollTop = (1/5) * (1000-100) = 180
    expect(el!.scrollTop).toBeCloseTo(180);
  });
});
