import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { readFileContent } from "../services/api";

export default function MdReader({ path, bookId }: { path: string; bookId: number }) {
  const [html, setHtml] = useState("");
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const containerRef = useRef<HTMLDivElement>(null);

  useJumpTarget((loc) => {
    const el = containerRef.current;
    if (!el) return;
    const pct = parseFloat(loc);
    if (Number.isFinite(pct)) {
      el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await readFileContent(path);
      if (!cancelled) setHtml(marked.parse(text) as string);
    })();
    return () => { cancelled = true; };
  }, [path]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, html, initialScroll]);

  return (
    <div className="md-reader" ref={containerRef} onScroll={onScroll}>
      <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
