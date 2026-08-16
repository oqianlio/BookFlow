import { useEffect, useMemo, useRef, useState } from "react";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { readLocalText } from "../services/localBookCache";
import { convertText, type Conversion } from "../services/tradSimpl";

const LINES_PER_PAGE = 40;

export default function TxtReader({ path, bookId, onError, conversion }: {
  path: string; bookId: number; onError?: (msg: string) => void; conversion?: Conversion;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { location, percent, loaded, save } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  // 搜索跳转可能在内容加载完成前到达：先缓存，行数/页数就绪后再定位
  const pendingJumpRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await readLocalText(path);
        if (cancelled) return;
        // 简繁转换（与书源正文一致）
        const converted = conversion && conversion !== "none" ? convertText(text, conversion) : text;
        setLines(converted.split(/\r?\n/));
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        onError?.(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [path, conversion]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE)), [lines]);

  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 0 && p < pageCount) setPage(p);
    }
  }, [loaded, location, pageCount]);

  // 供书签/标注读取当前页码
  useEffect(() => {
    (window as any).__readerLocation = String(page);
  }, [page]);

  const go = (p: number) => {
    const clamped = Math.min(Math.max(0, p), pageCount - 1);
    setPage(clamped);
    save(String(clamped), clamped / pageCount);
  };

  const goRef = useRef(go);
  goRef.current = go;

  const applyJump = (loc: string) => {
    // 搜索命中：行号 -> 页码（行号 0 基）
    if (loc.startsWith("line:")) {
      const line = parseInt(loc.slice(5), 10);
      if (Number.isFinite(line) && line >= 0) goRef.current(Math.floor(line / LINES_PER_PAGE));
      return;
    }
    const p = parseInt(loc, 10);
    if (Number.isFinite(p)) goRef.current(p);
  };

  useJumpTarget((loc) => {
    if (!readyRef.current) {
      // 内容尚未就绪：缓存跳转，就绪后补放
      pendingJumpRef.current = loc;
      return;
    }
    applyJump(loc);
  });

  // 内容就绪后补放加载前到达的搜索跳转
  useEffect(() => {
    if (readyRef.current) return;
    if (lines.length === 0) return;
    readyRef.current = true;
    const pj = pendingJumpRef.current;
    if (pj != null) {
      pendingJumpRef.current = null;
      applyJump(pj);
    }
  }, [lines]);

  return (
    <div className="txt-reader">
      {error && <p className="error">{error}</p>}
      <div className="txt-page" key={page}>
        {lines.slice(page * LINES_PER_PAGE, (page + 1) * LINES_PER_PAGE).map((l, i) => (
          <p key={i}>{l || "\u00A0"}</p>
        ))}
      </div>
      <div className="txt-nav">
        <button onClick={() => go(page - 1)} disabled={page === 0}>上一页</button>
        <span>{page + 1} / {pageCount}</span>
        <button onClick={() => go(page + 1)} disabled={page >= pageCount - 1}>下一页</button>
      </div>
    </div>
  );
}
