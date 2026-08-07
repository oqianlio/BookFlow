import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { readFileContent } from "../services/api";

export default function MdReader({ path, bookId, onError }: { path: string; bookId: number; onError?: (msg: string) => void }) {
  const [html, setHtml] = useState("");
  const [totalLines, setTotalLines] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const containerRef = useRef<HTMLDivElement>(null);
  // 搜索跳转可能在内容加载完成前到达：先缓存，内容就绪后再滚动定位
  const pendingJumpRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  const scrollTo = (pct: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
  };

  const applyJump = (loc: string) => {
    // 搜索命中：行号 -> 滚动百分比
    if (loc.startsWith("line:")) {
      const line = parseInt(loc.slice(5), 10);
      if (!Number.isFinite(line) || line < 0) return;
      const total = Math.max(1, totalLines);
      scrollTo(Math.min(1, line / total));
      return;
    }
    const pct = parseFloat(loc);
    if (Number.isFinite(pct)) scrollTo(pct);
  };

  useJumpTarget((loc) => {
    if (!readyRef.current) {
      // 内容尚未就绪：缓存跳转，就绪后补放
      pendingJumpRef.current = loc;
      return;
    }
    applyJump(loc);
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await readFileContent(path);
        if (cancelled) return;
        setTotalLines(text.split(/\r?\n/).length);
        // 用户导入的 Markdown 可能含恶意 HTML：marked 输出经 DOMPurify 清洗后再注入
        const raw = marked.parse(text) as string;
        setHtml(DOMPurify.sanitize(raw));
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        onError?.(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
    (window as any).__readerLocation = String(Math.round(pct * 1000) / 1000);
    saveDebounced(String(Math.round((pct + Number.EPSILON) * 1000) / 1000), pct);
  };

  const initialScroll = useMemo(() => {
    if (loaded && location) {
      const pct = parseFloat(location);
      return Number.isFinite(pct) ? pct : 0;
    }
    return 0;
  }, [loaded, location]);

  useEffect(() => {
    const el = containerRef.current;
    if (el && initialScroll > 0) {
      el.scrollTop = initialScroll * (el.scrollHeight - el.clientHeight);
    }
    // 内容就绪后发布初始位置，供书签/标注使用
    (window as any).__readerLocation = String(initialScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, html, initialScroll]);

  // 内容就绪后补放加载前到达的搜索跳转
  useEffect(() => {
    if (readyRef.current) return;
    if (!html) return;
    readyRef.current = true;
    const pj = pendingJumpRef.current;
    if (pj != null) {
      pendingJumpRef.current = null;
      applyJump(pj);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  return (
    <div className="md-reader" ref={containerRef} onScroll={onScroll}>
      {error && <p className="error">{error}</p>}
      <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
