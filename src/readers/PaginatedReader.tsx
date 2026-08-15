import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

export type PageMode = "scroll" | "cover" | "slide";

export interface TypographyStyle {
  letterSpacingPx: number;
  paragraphSpacingPx: number;
  indentEm: number;
  bold: boolean;
  fontFamily: string;
}

const DEFAULT_TYPO: TypographyStyle = { letterSpacingPx: 0, paragraphSpacingPx: 11, indentEm: 0, bold: false, fontFamily: "serif" };

export default function PaginatedReader({
  html, mode = "scroll", fontSizePx = 18, lineHeight = 1.8, typography, onPageChange, measure, onMenuToggle, onReachEnd, onReachStart,
}: {
  html: string; mode?: PageMode; fontSizePx?: number; lineHeight?: number;
  typography?: TypographyStyle;
  onPageChange?: (cur: number, total: number) => void;
  measure?: (h: string) => number;
  onMenuToggle?: () => void;
  onReachEnd?: () => void;
  onReachStart?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const ty = { ...DEFAULT_TYPO, ...typography };

  // 排版样式：批量测量时应用到隐藏容器（与阅读区一致的字体/行距/缩进等）
  const styleHtml = useMemo(() => {
    const css = [
      `font-size:${fontSizePx}px`,
      `line-height:${lineHeight}`,
      `letter-spacing:${ty.letterSpacingPx}px`,
      `text-indent:${ty.indentEm}em`,
      `font-weight:${ty.bold ? 700 : 400}`,
      `font-family:${ty.fontFamily}`,
      "white-space:normal",
    ].join(";");
    return `<style>.m-p{${css}} .m-p p{margin:0 0 ${ty.paragraphSpacingPx}px}</style>`;
  }, [fontSizePx, lineHeight, ty.letterSpacingPx, ty.paragraphSpacingPx, ty.indentEm, ty.bold, ty.fontFamily]);

  useEffect(() => {
    const h = wrapRef.current?.clientHeight || 500;
    const w = wrapRef.current?.clientWidth || 400;
    setPages(sliceHtmlIntoPages(html, h, w, measure, styleHtml));
    setPage(0);
  }, [html, measure, styleHtml]);

  const total = pages.length;
  const go = (p: number) => {
    const c = Math.min(Math.max(0, p), total - 1);
    setPage(c);
    onPageChange?.(c, total);
    // 向前翻触达末页（含单页章节点击翻页区域）→ 通知上层衔接下一章
    if (total > 0 && c === total - 1 && p > page) onReachEnd?.();
    // 从首页继续向前翻（越过首页）→ 通知上层衔接上一章
    if (total > 0 && page === 0 && p < 0) onReachStart?.();
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
          style={{
            display: i === page ? "block" : "none",
            lineHeight,
            letterSpacing: `${ty.letterSpacingPx}px`,
            textIndent: `${ty.indentEm}em`,
            fontWeight: ty.bold ? 700 : 400,
            fontFamily: ty.fontFamily,
            ["--para-gap" as any]: `${ty.paragraphSpacingPx}px`,
          }}
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
// measure 可注入（jsdom 测试用字符估算）；未注入时用批量隐藏容器测量（一次渲染全部块，
// 按 offsetTop 找页断点），避免逐块 append/remove 的 O(N) 重排。
export function sliceHtmlIntoPages(
  html: string,
  pageHeightPx: number,
  measureWidthPx: number,
  measure?: (h: string) => number,
  styleHtml = "",
): string[] {
  if (!html.trim()) return [];
  // 1. 拆分块级片段（p/div/h1-h6/li/pre），保留标签
  const blocks = Array.from(html.matchAll(/<(p|div|h[1-6]|li|pre)[^>]*>[\s\S]*?<\/\1>/g)).map((m) => m[0]);
  if (blocks.length === 0) return [html]; // 无块级 → 整篇一页
  if (measure) return sliceByAccumulate(blocks, pageHeightPx, measure);
  return sliceByBatchMeasure(blocks, pageHeightPx, measureWidthPx, styleHtml);
}

// 逐块累加测量（注入 measure 时使用，供无布局环境/测试）
function sliceByAccumulate(blocks: string[], pageHeightPx: number, measure: (h: string) => number): string[] {
  const pages: string[] = [];
  let cur = "";
  for (const b of blocks) {
    const h = measure(cur + b);
    if (h > pageHeightPx && cur) {
      pages.push(cur);
      cur = "";
    }
    cur += b;
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [blocks.join("")];
}

// 批量测量：隐藏容器一次渲染全部块，按 offsetTop 相对页首的位移找页断点（段落在页边界保留）
function sliceByBatchMeasure(blocks: string[], pageHeightPx: number, widthPx: number, styleHtml: string): string[] {
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${widthPx || 400}px;`;
  host.innerHTML = `${styleHtml}<div class="m-p">${blocks.join("")}</div>`;
  document.body.appendChild(host);
  try {
    const parent = host.firstElementChild as HTMLElement | null;
    if (!parent) return [blocks.join("")];
    const pages: string[] = [];
    let cur: string[] = [];
    let pageStart = 0;
    for (const el of Array.from(parent.children)) {
      const top = (el as HTMLElement).offsetTop;
      if (cur.length > 0 && top - pageStart >= pageHeightPx) {
        pages.push(cur.join(""));
        cur = [];
        pageStart = top;
      }
      cur.push((el as HTMLElement).outerHTML);
    }
    if (cur.length) pages.push(cur.join(""));
    return pages.length ? pages : [blocks.join("")];
  } finally {
    document.body.removeChild(host);
  }
}
