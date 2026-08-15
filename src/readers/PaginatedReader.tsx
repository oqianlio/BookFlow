export type PageMode = "scroll" | "cover" | "slide";

// 纯函数：把 html 的块级元素（p/div/h1-h6/li/pre）按高度切片为页数组（每页 html 字符串）。
// measure 可注入真实 DOM 测量（组件内用隐藏容器 getBoundingClientRect().height，见 Task 2），
// 默认用字符数估算（每 10 字符 15px），供 jsdom 测试等无布局环境使用。
export function sliceHtmlIntoPages(
  html: string,
  pageHeightPx: number,
  measureWidthPx: number,
  measure?: (h: string) => number,
): string[] {
  void measureWidthPx;
  if (!html.trim()) return [];
  // 1. 拆分块级片段（p/div/h1-h6/li/pre），保留标签
  const blocks = Array.from(html.matchAll(/<(p|div|h[1-6]|li|pre)[^>]*>[\s\S]*?<\/\1>/g)).map((m) => m[0]);
  if (blocks.length === 0) return [html]; // 无块级 → 整篇一页
  // 2. 逐块累加测量，高度超页则成页（段落在页边界保留，不截断）
  const m = measure ?? defaultMeasure;
  const pages: string[] = [];
  let cur = "";
  for (const b of blocks) {
    const h = m(cur + b);
    if (h > pageHeightPx && cur) {
      pages.push(cur);
      cur = "";
    }
    cur += b;
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [html];
}

function defaultMeasure(h: string): number {
  // 兜底：按字符数估算（每 10 字符 15px）；真实测量由组件内 measurement 容器覆盖
  return (h.length / 10) * 15;
}
