import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";

GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

export default function PdfReader({ path, bookId, onError }: { path: string; bookId: number; onError?: (msg: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reportError = (e: unknown) => {
    const msg = String(e);
    setError(msg);
    onErrorRef.current?.(msg);
  };
  const { location, percent, loaded, save } = useReaderProgress(bookId);
  useSaveOnLocationChange(bookId, location, percent, save);
  const pageRef = useRef(page);
  pageRef.current = page;
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;

  useJumpTarget((loc) => {
    const p = parseInt(loc, 10);
    if (!Number.isFinite(p)) return;
    setPage(Math.min(Math.max(1, p), numPagesRef.current || p));
  });

  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 1) setPage(p);
    }
  }, [loaded, location]);

  const renderPage = async (pageNum: number, scale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pdf = await getDocument({ url: convertFileSrc(path) }).promise;
    const p = await pdf.getPage(pageNum);
    const viewport = p.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdf = await getDocument({ url: convertFileSrc(path) }).promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);
        await renderPage(pageRef.current, zoom);
      } catch (e) {
        reportError(e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded]);

  useEffect(() => {
    void renderPage(page, zoom).catch(reportError);
    save(String(page), page / Math.max(1, numPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, numPages]);

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
        <span>{numPages ? `${page} / ${numPages}` : "加载中…"}</span>
        <button className="btn-secondary" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>下一页</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => +(z - 0.2).toFixed(2))}>缩小</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => +(z + 0.2).toFixed(2))}>放大</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="pdf-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
