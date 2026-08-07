import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";

GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

const MIN_ZOOM = 0.2;

export default function PdfReader({ path, bookId, onError }: { path: string; bookId: number; onError?: (msg: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 文档只打开一次并缓存，翻页/缩放复用；卸载时销毁 loadingTask
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  // 渲染代际计数：取消过期的翻页/缩放渲染
  const renderGenRef = useRef(0);
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

  const renderPage = async (pageNum: number, scale: number) => {
    const canvas = canvasRef.current;
    const pdf = pdfRef.current;
    if (!canvas || !pdf) return;
    const gen = ++renderGenRef.current;
    const p = await pdf.getPage(pageNum);
    // 渲染期间发生了新的翻页/缩放请求，丢弃本页
    if (gen !== renderGenRef.current) return;
    const viewport = p.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = p.render({ canvas, canvasContext: ctx, viewport });
    await task.promise;
  };

  // 打开文档一次（每个 path 一次），设置页数；打开失败才升级为顶层错误框
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const task = getDocument({ url: convertFileSrc(path) });
        loadingTaskRef.current = task;
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch (e) {
        if (cancelled) return;
        reportError(e);
      }
    })();
    return () => {
      cancelled = true;
      renderGenRef.current += 1;
      pdfRef.current = null;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // 恢复上次阅读页码
  useEffect(() => {
    if (loaded && location != null) {
      const p = parseInt(location, 10);
      if (Number.isFinite(p) && p >= 1) setPage(p);
    }
  }, [loaded, location]);

  // 翻页/缩放：从缓存的文档渲染当前页，并同步阅读位置/进度
  useEffect(() => {
    if (!numPages) return;
    (window as any).__readerLocation = String(page);
    void renderPage(page, zoom).catch((e) => setError(String(e)));
    save(String(page), page / numPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, numPages]);

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
        <span>{numPages ? `${page} / ${numPages}` : "加载中…"}</span>
        <button className="btn-secondary" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>下一页</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.2).toFixed(2)))}>缩小</button>
        <button className="btn-secondary" onClick={() => setZoom((z) => +(z + 0.2).toFixed(2))}>放大</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="pdf-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
