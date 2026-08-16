import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { readLocalText } from "../services/localBookCache";
import { convertText, type Conversion } from "../services/tradSimpl";
import { sliceHtmlIntoPages } from "./PaginatedReader";

export default function MdReader({ path, bookId, onError, conversion }: {
  path: string; bookId: number; onError?: (msg: string) => void; conversion?: Conversion;
}) {
  const [html, setHtml] = useState("");
  const [totalLines, setTotalLines] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const wrapRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const pendingJumpRef = useRef<string | null>(null);

  // 分页：按容器可用高度切分 markdown 渲染结果（与书源正文一致的翻页式，不滚动）
  const styleHtml = useMemo(() => `<style>.md-slice{font-family:inherit} .md-slice h1,.md-slice h2,.md-slice h3{line-height:1.4;margin:1.2em 0 0.6em} .md-slice p{margin:0 0 1.1em} .md-slice pre{overflow-x:auto} .md-slice img{max-width:100%} .md-slice blockquote{margin:0 0 1.1em;padding:0 1em;border-left:3px solid #ccc;color:#777} .md-slice table{border-collapse:collapse} .md-slice td,.md-slice th{border:1px solid #ddd;padding:4px 8px}</style>`, []);
  const pages = useMemo(() => {
    if (!html) return [] as string[];
    const el = wrapRef.current;
    const h = Math.max(120, (el?.clientHeight ?? 600) - 24);
    const w = el?.clientWidth ?? 600;
    return sliceHtmlIntoPages(html, h, w, undefined, styleHtml);
  }, [html, styleHtml]);
  const total = pages.length;

  const savePage = useCallback((p: number) => {
    const t = Math.max(1, pages.length);
    const loc = String(p);
    (window as any).__readerLocation = loc;
    saveDebounced(loc, p / t);
  }, [pages.length, saveDebounced]);

  const go = useCallback((p: number) => {
    setPage((prev) => {
      const c = Math.min(Math.max(0, p), Math.max(0, pages.length - 1));
      if (c !== prev) savePage(c);
      return c;
    });
  }, [pages.length, savePage]);

  // 键盘翻页：←/→/空格/PgUp/PgDn（输入框聚焦时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(page + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(page - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages.length, go]);

  const applyJump = useCallback((loc: string) => {
    // 搜索命中：行号 -> 按行比例估算页码
    if (loc.startsWith("line:")) {
      const line = parseInt(loc.slice(5), 10);
      if (!Number.isFinite(line) || line < 0) return;
      const totalL = Math.max(1, totalLines);
      const target = Math.floor((line / totalL) * Math.max(1, pages.length));
      go(target);
      return;
    }
    const p = parseInt(loc, 10);
    if (Number.isFinite(p)) go(p);
  }, [go, pages.length, totalLines]);

  useJumpTarget((loc) => {
    if (!readyRef.current || pages.length === 0) {
      pendingJumpRef.current = loc;
      return;
    }
    applyJump(loc);
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await readLocalText(path);
        if (cancelled) return;
        setTotalLines(text.split(/\r?\n/).length);
        const converted = conversion && conversion !== "none" ? convertText(text, conversion) : text;
        const raw = marked.parse(converted) as string;
        setHtml(DOMPurify.sanitize(raw));
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        onError?.(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [path, conversion]);

  // 恢复进度（页码）
  useEffect(() => {
    if (loaded && location && pages.length > 0) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p > 0 && p < pages.length) setPage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pages.length]);

  // 内容就绪：补放搜索跳转 + 发布初始位置
  useEffect(() => {
    if (readyRef.current || pages.length === 0) return;
    readyRef.current = true;
    (window as any).__readerLocation = String(page);
    const pj = pendingJumpRef.current;
    if (pj != null) {
      pendingJumpRef.current = null;
      applyJump(pj);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length]);

  return (
    <div className="md-reader md-paged" ref={wrapRef} onMouseDown={(e) => e.preventDefault()}>
      {error && <p className="error">{error}</p>}
      {pages.length > 0 && (
        <>
          <div className="md-content md-slice" dangerouslySetInnerHTML={{ __html: pages[page] ?? "" }} />
          <div className="reader-slice-nav">
            <button onClick={(e) => { e.stopPropagation(); go(page - 1); }} disabled={page === 0}>‹</button>
            <span>{total ? `${page + 1} / ${total}` : "0 / 0"}</span>
            <button onClick={(e) => { e.stopPropagation(); go(page + 1); }} disabled={page >= total - 1}>›</button>
          </div>
        </>
      )}
    </div>
  );
}
