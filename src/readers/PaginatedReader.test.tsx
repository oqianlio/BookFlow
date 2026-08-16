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

  it("splits unclosed <p> content via DOM fallback (common in source HTML)", () => {
    // 未闭合 p：正则匹配不到，DOM 解析器自动补全 → 多块 → 多页
    const long = Array.from({ length: 30 }, (_, i) => `<p>未闭合段落${i}${"字".repeat(9)}`).join("");
    const pages = sliceHtmlIntoPages(long, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("未闭合段落0");
  });

  it("splits <br>-separated text content via DOM fallback", () => {
    // br 分段（"您现在阅读的是xxx小说网提供的…"式正文）
    const long = Array.from({ length: 30 }, (_, i) => `第${i}行内容${"字".repeat(8)}<br>`).join("");
    const pages = sliceHtmlIntoPages(long, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("splits bare multiline text via DOM fallback", () => {
    // 纯文本无标签、按换行分段
    const long = Array.from({ length: 30 }, (_, i) => `纯文本第${i}段${"字".repeat(8)}`).join("\n");
    const pages = sliceHtmlIntoPages(long, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("keeps a single unclosed long paragraph as one overflowing page", () => {
    // 单个未闭合 p 超长：DOM 回退仍是 1 块，保持"超页不截断"语义
    const huge = `<p>${"长".repeat(500)}`;
    const pages = sliceHtmlIntoPages(huge, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBe(1);
  });

  it("does not escape into double-wrapped divs for normal closed content", () => {
    // 正常闭合多段：正则快速路径（30 块）优先，不用 DOM 回退
    const long = Array.from({ length: 30 }, (_, i) => `<p>段落${i}${"字".repeat(9)}</p>`).join("");
    const pages = sliceHtmlIntoPages(long, HEIGHT, 400, mockMeasure);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.trim().startsWith("<p>")).toBe(true);
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
    render(<PaginatedReader html={CONTENT} mode="cover" onPageChange={onPageChange} measure={mockMeasure} />);
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
      <PaginatedReader html={CONTENT} mode="cover" lineHeight={1.8} measure={mockMeasure} onPageChange={onPageChange} />,
    );
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.style.lineHeight).toBe("1.8");
    rerender(<PaginatedReader html={CONTENT} mode="cover" lineHeight={2.4} measure={mockMeasure} onPageChange={onPageChange} />);
    expect(container.querySelector(".reader-page-slice")!.getAttribute("style")).toContain("2.4");
  });

  it("applies typography styles to the slice container", () => {
    const typography = { letterSpacingPx: 1.5, paragraphSpacingPx: 16, indentEm: 1, bold: true, fontFamily: "serif" };
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" typography={typography} measure={mockMeasure} />);
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.style.letterSpacing).toBe("1.5px");
    expect(slice.style.textIndent).toBe("1em");
    expect(slice.style.fontWeight).toBe("700");
    expect(slice.style.fontFamily).toBe("serif");
  });

  it("does not call onReachEnd on initial render or when navigating away from the end", () => {
    const onReachEnd = vi.fn();
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} onReachEnd={onReachEnd} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    expect(onReachEnd).not.toHaveBeenCalled();
    // 点击左侧（clamp 到首页，非末页）也不触发
    fireEvent.click(wrap, { clientX: 100 });
    expect(onReachEnd).not.toHaveBeenCalled();
  });

  it("does not call onReachEnd when navigating to the last page (10/11 → 11/11 is normal flip)", () => {
    const onReachEnd = vi.fn();
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} onReachEnd={onReachEnd} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    const span = wrap.querySelector(".reader-slice-nav span")!;
    const total = Number(span.textContent!.split("/")[1].trim());
    expect(total).toBeGreaterThan(1);
    // 一路翻到最后一页（含 10/11 → 11/11 的正常翻页）→ 不触发下一章
    for (let i = 1; i < total; i++) fireEvent.click(wrap, { clientX: 900 });
    expect(span.textContent).toBe(`${total} / ${total}`);
    expect(onReachEnd).not.toHaveBeenCalled();
  });

  it("calls onReachEnd only when flipping past the last page", () => {
    const onReachEnd = vi.fn();
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} onReachEnd={onReachEnd} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    const span = wrap.querySelector(".reader-slice-nav span")!;
    const total = Number(span.textContent!.split("/")[1].trim());
    // 翻到最后一页
    for (let i = 1; i < total; i++) fireEvent.click(wrap, { clientX: 900 });
    expect(onReachEnd).not.toHaveBeenCalled();
    // 在末页再点下一页（越过末页）→ 触发下一章衔接
    fireEvent.click(wrap, { clientX: 900 });
    expect(onReachEnd).toHaveBeenCalledTimes(1);
  });

  it("treats a single-page chapter flip as reaching the end", () => {
    const onReachEnd = vi.fn();
    const { container } = render(<PaginatedReader html="<p>只有一页</p>" mode="cover" measure={mockMeasure} onReachEnd={onReachEnd} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    fireEvent.click(wrap, { clientX: 900 });
    expect(onReachEnd).toHaveBeenCalledTimes(1);
  });

  it("calls onReachStart when flipping back past the first page", () => {
    const onReachStart = vi.fn();
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} onReachStart={onReachStart} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    // 初始在首页，点击左侧（继续向前）→ 越过首页 → 触发上一章衔接
    fireEvent.click(wrap, { clientX: 100 });
    expect(onReachStart).toHaveBeenCalledTimes(1);
  });

  it("does not call onReachStart on initial render or when flipping back to the first page", () => {
    const onReachStart = vi.fn();
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} onReachStart={onReachStart} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    expect(onReachStart).not.toHaveBeenCalled();
    // 翻到第 2 页，再翻回首页（非越过首页）→ 不触发
    fireEvent.click(wrap, { clientX: 900 });
    fireEvent.click(wrap, { clientX: 100 });
    expect(onReachStart).not.toHaveBeenCalled();
  });

  it("treats a single-page chapter back-flip as reaching the start", () => {
    const onReachStart = vi.fn();
    const onReachEnd = vi.fn();
    const { container } = render(<PaginatedReader html="<p>只有一页</p>" mode="cover" measure={mockMeasure} onReachStart={onReachStart} onReachEnd={onReachEnd} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    // 单页章节点击左侧 → 上一章衔接；不误触发下一章
    fireEvent.click(wrap, { clientX: 100 });
    expect(onReachStart).toHaveBeenCalledTimes(1);
    expect(onReachEnd).not.toHaveBeenCalled();
  });

  it("keyboard ArrowRight/ArrowLeft flips pages", () => {
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    const span = wrap.querySelector(".reader-slice-nav span")!;
    const total = Number(span.textContent!.split("/")[1].trim());
    expect(total).toBeGreaterThan(1);
    // 初始 1/总
    expect(span.textContent).toBe(`1 / ${total}`);
    // → 翻下一页
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(span.textContent).toBe(`2 / ${total}`);
    // ← 翻回
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(span.textContent).toBe(`1 / ${total}`);
  });

  it("keyboard input focus does not flip pages", () => {
    const { container } = render(<PaginatedReader html={CONTENT} mode="cover" measure={mockMeasure} />);
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    const span = wrap.querySelector(".reader-slice-nav span")!;
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(span.textContent).toMatch(/^1 \//);
    document.body.removeChild(input);
  });
});
