import { useCallback, useEffect, useRef, useState } from "react";
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import AnnotationPanel from "../components/AnnotationPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import TtsBar from "../components/TtsBar";
import { addBookmark, type Book } from "../services/api";
import "./ReaderPage.css";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  const [panel, setPanel] = useState<"annotations" | "bookmarks" | null>(null);
  const jumpKey = useRef(0);

  const jump = useCallback((loc: string) => {
    const w = window as any;
    w.__jumpTo = loc;
    jumpKey.current += 1;
    w.dispatchEvent(new CustomEvent("reader-jump", { detail: loc }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const w = window as any;
        const loc = w.__readerLocation ?? "";
        if (loc) w.__requestBookmark?.();
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPanel((p) => (p === "annotations" ? null : "annotations"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onRequestBookmark = (e: Event) => {
      const w = window as any;
      const detail = (e as CustomEvent).detail as string | undefined;
      const loc = detail || w.__bookmarkLocation || "";
      if (!loc) return;
      void addBookmark({ bookId: book.id, location: loc, label: `书签 ${new Date().toLocaleString("zh-CN")}` });
      w.dispatchEvent(new CustomEvent("bookmark-changed"));
    };
    window.addEventListener("request-bookmark", onRequestBookmark);
    return () => window.removeEventListener("request-bookmark", onRequestBookmark);
  }, [book.id]);

  useEffect(() => {
    const locateMatch = (text: string) => {
      if (book.format === "epub" || book.format === "pdf") return;
      const t = setTimeout(() => {
        try {
          (window as any).find(text, false, false, false, false, true, true);
        } catch { /* window.find 不可用时忽略 */ }
      }, 250);
      return () => clearTimeout(t);
    };
    const w = window as any;
    const pending = w.__searchJump as { text?: string } | undefined;
    if (pending?.text) {
      w.__searchJump = undefined;
      locateMatch(pending.text);
    }
    const onSearchJump = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined;
      if (detail?.text) locateMatch(detail.text);
    };
    window.addEventListener("search-jump", onSearchJump);
    return () => window.removeEventListener("search-jump", onSearchJump);
  }, [book.format]);

  return (
    <div className="reader-page">
      <header className="reader-toolbar">
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
        <h2>{book.title}</h2>
        <button className="btn-secondary" onClick={() => setPanel((p) => (p === "annotations" ? null : "annotations"))}>标注</button>
        <button className="btn-secondary" onClick={() => setPanel((p) => (p === "bookmarks" ? null : "bookmarks"))}>书签</button>
        <TtsBar />
      </header>
      <div className="reader-body">
        <main className="reader-main">
          {book.format === "epub" && <EpubReader path={book.path} bookId={book.id} />}
          {book.format === "pdf" && <PdfReader path={book.path} bookId={book.id} />}
          {book.format === "md" && <MdReader path={book.path} bookId={book.id} />}
          {book.format === "txt" && <TxtReader path={book.path} bookId={book.id} />}
        </main>
        {panel === "annotations" && (
          <AnnotationPanel bookId={book.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
        {panel === "bookmarks" && (
          <BookmarkPanel bookId={book.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
      </div>
    </div>
  );
}
