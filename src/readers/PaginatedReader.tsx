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
  // padding/max-width 与 .reader-page-slice 保持一致（CSS 同步修改），否则测量与渲染
  // 尺寸不一致 → 每页内容超高需滚动
  const styleHtml = useMemo(() => {
    const css = [
      `font-size:${fontSizePx}px`,
      `line-height:${lineHeight}`,
      `letter-spacing:${ty.letterSpacingPx}px`,
      `text-indent:${ty.indentEm}em`,
      `font-weight:${ty.bold ? 700 : 400}`,
      `font-family:${ty.fontFamily}`,
      "white-space:normal",
      "padding:4px 10px 20px",
      "max-width:46em",
      "margin:0 auto",
      "box-sizing:border-box",
    ].join(";");
    return `<style>.m-p{${css}} .m-p p{margin:0 0 ${ty.paragraphSpacingPx}px}</style>`;
  }, [fontSizePx, lineHeight, ty.letterSpacingPx, ty.paragraphSpacingPx, ty.indentEm, ty.bold, ty.fontFamily]);

  useEffect(() => {
    // 分页测量高度 = 容器高度 - slice 垂直 padding（4 顶 + 20 底），
    // 与 .reader-page-slice 的真实可用内容高度一致，避免每页内容超高
    const rawH = wrapRef.current?.clientHeight || 500;
    const h = Math.max(120, rawH - 24);
    const w = wrapRef.current?.clientWidth || 400;
    setPages(sliceHtmlIntoPages(html, h, w, measure, styleHtml));
    setPage(0);
  }, [html, measure, styleHtml]);

  const total = pages.length;
  const go = (p: number) => {
    const c = Math.min(Math.max(0, p), total - 1);
    setPage(c);
    onPageChange?.(c, total);
    // 越过末页继续向前翻（p > 最后一页；含单页章节点击翻页区域）→ 通知上层衔接下一章。
    // 注意：翻到最后一页本身（10/11 → 11/11）不触发，只有从末页再往前翻才触发
    if (total > 0 && p > total - 1) onReachEnd?.();
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
  let blocks = Array.from(html.matchAll(/<(p|div|h[1-6]|li|pre)[^>]*>[\s\S]*?<\/\1>/g)).map((m) => m[0]);
  // 正则匹配 ≤1 块 → 常见于未闭合标签、<br> 分段、纯文本正文（书源 HTML 常态）：
  // 用 DOM 解析回退（HTML5 解析器自动补全未闭合标签，br/换行作段边界）
  if (blocks.length <= 1) {
    const domBlocks = extractBlocksByDom(html);
    if (domBlocks.length > blocks.length) blocks = domBlocks;
  }
  if (blocks.length === 0) return [html]; // 无块级 → 整篇一页
  if (measure) return sliceByAccumulate(blocks, pageHeightPx, measure);
  return sliceByBatchMeasure(blocks, pageHeightPx, measureWidthPx, styleHtml);
}

const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre",
  "table", "ul", "ol", "blockquote", "section", "article", "figure", "tr",
]);

/** DOM 解析分块：HTML5 解析器补全未闭合标签；块级元素独立成块，
 *  文本/内联元素按 <br> 与换行断段（纯文本正文可正确分页）。 */
function extractBlocksByDom(html: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) {
      out.push(`<div>${buf}</div>`);
      buf = "";
    }
  };
  for (const node of Array.from(host.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag)) {
        flush();
        out.push(el.outerHTML);
      } else if (tag === "br") {
        flush(); // <br> 作段边界
      } else {
        buf += el.outerHTML; // 内联 span/a/b/img 等归入当前段
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      // 裸文本按换行分段（纯文本正文）
      const segs = (node.textContent ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const seg of segs) {
        flush();
        buf += escapeHtml(seg);
        flush();
      }
    }
  }
  flush();
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  // .m-p 设 position:relative：让子块 offsetTop 相对测量容器自身（offsetParent 链稳定）
  host.innerHTML = `${styleHtml}<div class="m-p" style="position:relative">${blocks.join("")}</div>`;
  document.body.appendChild(host);
  try {
    // 注意：styleHtml 注入后 host 第一个子元素是 <style>，必须取 .m-p 测量容器
    const parent = host.querySelector(".m-p") as HTMLElement | null;
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
