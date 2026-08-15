import { describe, it, expect } from "vitest";
import { sliceHtmlIntoPages } from "./PaginatedReader";

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
