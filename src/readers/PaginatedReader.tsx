import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export type PageMode = "scroll" | "cover" | "slide";

export default function PaginatedReader({
  html, mode = "scroll", fontSizePx = 18, onPageChange, measure, onMenuToggle,
}: {
  html: string; mode?: PageMode; fontSizePx?: number;
  onPageChange?: (cur: number, total: number) => void;
  measure?: (h: string) => number;
  onMenuToggle?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // 真实测量：隐藏容器
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const realMeasure = useCallback((h: string): number => {
    if (measureRef.current) return measureRef.current(h);
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;visibility:hidden;width:${wrapRef.current?.clientWidth ?? 400}px;font-size:${fontSizePx}px;white-space:normal;`;
    el.innerHTML = h;
    document.body.appendChild(el);
    const height = el.getBoundingClientRect().height;
    document.body.removeChild(el);
    return height;
  }, [fontSizePx]);

  useEffect(() => {
    const h = wrapRef.current?.clientHeight ?? 500;
    const w = wrapRef.current?.clientWidth ?? 400;
    setPages(sliceHtmlIntoPages(html, h, w, realMeasure));
    setPage(0);
  }, [html, realMeasure]);

  const total = pages.length;
  const go = (p: number) => {
    const c = Math.min(Math.max(0, p), total - 1);
    setPage(c);
    onPageChange?.(c, total);
  };

  useEffect(() => { onPageChange?.(0, total); }, [total]); // 初始上报

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;
    if (x < third) go(page - 1);
    else if (x > third * 2) go(page + 1);
    else onMenuToggle?.();  // 中区 → 呼出菜单（由 ReaderPage 传入）
  };

  if (!html.trim()) return <p className="panel-empty">无内容</p>;

  return (
    <div className="reader-slice-wrap" ref={wrapRef} onClick={handleClick} style={{ fontSize: fontSizePx }}>
      {pages.map((p, i) => (
        <div
          key={i}
          className={`reader-page-slice${i === page ? " active" : ""}${mode === "slide" ? " slide" : ""}`}
          style={{ display: i === page ? "block" : "none" }}
          dangerouslySetInnerHTML={{ __html: p }}
        />
      ))}
      <div className="reader-slice-nav">
        <button onClick={(e) => { e.stopPropagation(); go(page - 1); }} disabled={page === 0}>‹</button>
        <span>{total ? `${page + 1} / ${total}` : "0 / 0"}</span>
        <button onClick={(e) => { e.stopPropagation(); go(page + 1); }} disabled={page >= total - 1}>›</button>
      </div>
    </div>
  );
}

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
