import { useEffect, useRef } from "react";
import ePub, { Book as EpubBook, Rendition } from "epubjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReaderProgress } from "./useReaderProgress";
import { useSaveOnLocationChange } from "./common";

export default function EpubReader({ path, bookId }: { path: string; bookId: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { location, percent, loaded, save, saveDebounced } = useReaderProgress(bookId);
  const saveDebouncedRef = useRef(saveDebounced);
  saveDebouncedRef.current = saveDebounced;
  useSaveOnLocationChange(bookId, location, percent, save);

  useEffect(() => {
    if (!hostRef.current) return;
    const book = ePub(convertFileSrc(path));
    bookRef.current = book;
    const rendition = book.renderTo(hostRef.current, { flow: "paginated", width: "100%", height: "100%" });
    renditionRef.current = rendition;
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
      await rendition.book.locations.generate(1600).catch(() => {});
      if (loaded && location) {
        await rendition.display(location);
      } else {
        await rendition.display();
      }
    })();
    return () => {
      rendition.destroy();
      book.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded]);

  return <div className="reader-host" ref={hostRef} />;
}
