import { useEffect, useRef, useState } from "react";
import ePub, { Book as EpubBook, Rendition } from "epubjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useJumpTarget, useSaveOnLocationChange } from "./common";
import { addAnnotation, deleteAnnotation, listAnnotations } from "../services/api";
import { applyAnnotations, installSelectionHandler, removeHighlight, type StoredAnnotation } from "./epubAnnotation";

export default function EpubReader({ path, bookId, onError }: { path: string; bookId: number; onError?: (msg: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  const saveDebouncedRef = useRef(saveDebounced);
  saveDebouncedRef.current = saveDebounced;
  useSaveOnLocationChange(bookId, location, percent, save);
  useJumpTarget((loc) => {
    void renditionRef.current?.display(loc);
  });

  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<StoredAnnotation[]>([]);
  const [renditionKey, setRenditionKey] = useState(0);
  const appliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hostRef.current) return;
    const book = ePub(convertFileSrc(path));
    bookRef.current = book;
    const rendition = book.renderTo(hostRef.current, { flow: "paginated", width: "100%", height: "100%" });
    renditionRef.current = rendition;
    appliedRef.current = new Set();
    installSelectionHandler(rendition, async (text, cfiRange) => {
      const id = await addAnnotation({ bookId, format: "epub", location: cfiRange, text, color: "yellow" });
      setAnnotations((prev) => [...prev, { id, location: cfiRange, text, color: "yellow" }]);
    });
    const w = window as any;
    w.__requestBookmark = () => {
      const loc = (rendition.currentLocation() as any)?.start?.cfi;
      if (!loc) return;
      w.__bookmarkLocation = loc;
      w.dispatchEvent(new CustomEvent("request-bookmark", { detail: loc }));
    };
    rendition.on("relocated", (locationObj: any) => {
      const start = locationObj.start?.cfi;
      if (!start) return;
      (window as any).__readerLocation = start;
      let pct = 0;
      try { pct = rendition.book.locations.percentageFromCfi(start); } catch { /* ignore */ }
      saveDebouncedRef.current(start, pct);
    });
    void (async () => {
      try {
        await book.ready;
        await rendition.book.locations.generate(1600).catch(() => {});
        if (loaded && location) {
          await rendition.display(location);
        } else {
          await rendition.display();
        }
      } catch (e) {
        const msg = String(e);
        setError(msg);
        onErrorRef.current?.(msg);
      }
    })();
    setRenditionKey((k) => k + 1);
    return () => {
      rendition.destroy();
      book.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = (await listAnnotations(bookId)) as any[];
      if (!cancelled) {
        setAnnotations(list.map((a) => ({ id: a.id, location: a.location, text: a.text, color: a.color })));
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  useEffect(() => {
    const onAnnotationsChanged = () => {
      void listAnnotations(bookId).then((list) => {
        setAnnotations((list as any[]).map((a) => ({ id: a.id, location: a.location, text: a.text, color: a.color })));
      });
    };
    window.addEventListener("annotation-changed", onAnnotationsChanged);
    return () => window.removeEventListener("annotation-changed", onAnnotationsChanged);
  }, [bookId]);

  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    const applied = appliedRef.current;
    for (const loc of [...applied]) {
      if (!annotations.some((a) => a.location === loc)) {
        removeHighlight(r, loc);
        applied.delete(loc);
      }
    }
    const seen = new Set<string>();
    const fresh = annotations.filter((a) => {
      if (applied.has(a.location) || seen.has(a.location)) return false;
      seen.add(a.location);
      return true;
    });
    if (fresh.length > 0) {
      applyAnnotations(r, fresh, (id) => {
        void deleteAnnotation(id);
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
      });
      for (const a of fresh) applied.add(a.location);
    }
  }, [annotations, renditionKey]);

  return (
    <div className="epub-reader">
      {error && <p className="error">{error}</p>}
      <div className="reader-host" ref={hostRef} />
    </div>
  );
}
