import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PaginatedReader, { sliceHtmlIntoPages } from "./PaginatedReader";

const HEIGHT = 300;

// 可预测的测量函数替代真实 DOM 测量（jsdom 无布局）：每 10 字符 15px，300px = 200 字符/页
function mockMeasure(h: string): number {
  return (h.length / 10) * 15;
}

describe("sliceHtmlIntoPages", () => {
  it("returns one page for short content", () => {
    const html = "<p>短内容</p>";
    const pages = sliceHtmlIntoPages(html, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBe(1);
    expect(pages[0]).toContain("短内容");
  });

  it("splits long content into multiple pages preserving paragraph boundaries", () => {
    // 每段 12~13 字符（含标签 19~20），30 段总计超过 200 字符/页
    const long = Array.from({ length: 30 }, (_, i) => `<p>段落${i}${"字".repeat(9)}</p>`).join("");
    const pages = sliceHtmlIntoPages(long, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBeGreaterThan(1);
    // 每页以完整段落开头（段落在页边界保留）
    for (const p of pages) expect(p.trim().startsWith("<p>")).toBe(true);
  });

  it("handles a single paragraph taller than one page by overflowing", () => {
    const huge = `<p>${"长".repeat(500)}</p>`; // 500 字符 > 200/页
    const pages = sliceHtmlIntoPages(huge, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBe(1); // 超页段落不截断，单页溢出
  });

  it("returns empty array for empty input", () => {
    expect(sliceHtmlIntoPages("", HEIGHT, 400, mockMeasure)).toEqual([]);
  });
});

const CONTENT = Array.from({ length: 30 }, (_, i) => `<p>段落${i}${"字".repeat(9)}</p>`).join("");

// jsdom 无布局：给 wrap 注入宽度，让区域点击（左/中/右 1/3）可判定
function mockWrapRect(el: HTMLElement, width = 1200) {
  el.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: width, bottom: 100, width, height: 100, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("PaginatedReader", () => {
  it("renders current page and reports progress", () => {
    const onPageChange = vi.fn();
    render(<PaginatedReader html={CONTENT} mode="scroll" onPageChange={onPageChange} measure={mockMeasure} />);
    expect(onPageChange).toHaveBeenCalledWith(0, expect.any(Number));
    // 首页内容可见
    const wrap = screen.getByText(/段落0/);
    expect(wrap).toBeInTheDocument();
  });

  it("next/prev navigates pages and region click flips", () => {
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    // 初始页 1 / total
    expect(wrap.querySelector(".reader-slice-nav span")!.textContent).toMatch(/^1 \/ \d+$/);
    // 点击右 1/3 → next
    fireEvent.click(wrap, { clientX: 900 });
    expect(wrap.querySelector(".reader-slice-nav span")!.textContent).toMatch(/^2 \/ \d+$/);
    // 点击左 1/3 → prev
    fireEvent.click(wrap, { clientX: 100 });
    expect(wrap.querySelector(".reader-slice-nav span")!.textContent).toMatch(/^1 \/ \d+$/);
  });

  it("renders empty state for empty html", () => {
    render(<PaginatedReader html="" />);
    expect(screen.getByText(/无内容/)).toBeInTheDocument();
  });

  it("applies lineHeight to the slice container and re-slices when it changes", () => {
    const onPageChange = vi.fn();
    const { container, rerender } = render(
      <PaginatedReader html={CONTENT} mode="scroll" lineHeight={1.8} measure={mockMeasure} onPageChange={onPageChange} />,
    );
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.style.lineHeight).toBe("1.8");
    rerender(<PaginatedReader html={CONTENT} mode="scroll" lineHeight={2.4} measure={mockMeasure} onPageChange={onPageChange} />);
    expect(container.querySelector(".reader-page-slice")!.getAttribute("style")).toContain("2.4");
  });

  it("applies typography styles to the slice container", () => {
    const typography = { letterSpacingPx: 1.5, paragraphSpacingPx: 16, indentEm: 1, bold: true, fontFamily: "serif" };
    const { container } = render(<PaginatedReader html={CONTENT} mode="scroll" typography={typography} measure={mockMeasure} />);
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.style.letterSpacing).toBe("1.5px");
    expect(slice.style.textIndent).toBe("1em");
    expect(slice.style.fontWeight).toBe("700");
    expect(slice.style.fontFamily).toBe("serif");
  });
});
