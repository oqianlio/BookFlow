import { useEffect, useMemo, useRef, useState } from "react";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { readFileContent } from "../services/api";

const LINES_PER_PAGE = 40;

export default function TxtReader({ path, bookId, onError }: { path: string; bookId: number; onError?: (msg: string) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { location, percent, loaded, save } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await readFileContent(path);
        if (!cancelled) setLines(text.split(/\r?\n/));
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        onError?.(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE)), [lines]);

  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 0 && p < pageCount) setPage(p);
    }
  }, [loaded, location, pageCount]);

  const go = (p: number) => {
    const clamped = Math.min(Math.max(0, p), pageCount - 1);
    setPage(clamped);
    save(String(clamped), clamped / pageCount);
  };

  const goRef = useRef(go);
  goRef.current = go;

  useJumpTarget((loc) => {
    const p = parseInt(loc, 10);
    if (Number.isFinite(p)) goRef.current(p);
  });

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
