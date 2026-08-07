import { useCallback, useEffect, useRef, useState } from "react";
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import AnnotationPanel from "../components/AnnotationPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import TtsBar from "../components/TtsBar";
import { BackIcon, BookmarkIcon, HighlightIcon } from "../components/icons";
import { addBookmark, removeBook, type Book } from "../services/api";
import "./ReaderPage.css";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  const [panel, setPanel] = useState<"annotations" | "bookmarks" | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const jumpKey = useRef(0);

  const handleRemoveBroken = async () => {
    try {
      await removeBook(book.id);
    } catch (e) {
      setOpenError(String(e));
      return;
    }
    onBack();
  };

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
        if (!loc) return;
        if (w.__requestBookmark) {
          w.__requestBookmark();
        } else {
          // EPUB 走 request-bookmark 事件；其余格式直接使用已发布的 __readerLocation
          void addBookmark({ bookId: book.id, location: loc, label: `书签 ${new Date().toLocaleString("zh-CN")}` });
          w.dispatchEvent(new CustomEvent("bookmark-changed"));
        }
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPanel((p) => (p === "annotations" ? null : "annotations"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book.id]);

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
    // 全文搜索跳转：把命中的定位信息交给当前格式的阅读器（reader-jump 事件）
    const routeSearchJump = (loc?: string) => {
      if (!loc) return;
      jump(loc);
    };
    const onSearchJump = (e: Event) => {
      const detail = (e as CustomEvent).detail as { location?: string } | undefined;
      routeSearchJump(detail?.location);
    };
    const w = window as any;
    const pending = w.__searchJump as { location?: string } | undefined;
    if (pending?.location) {
      w.__searchJump = undefined;
      routeSearchJump(pending.location);
    }
    window.addEventListener("search-jump", onSearchJump);
    return () => window.removeEventListener("search-jump", onSearchJump);
  }, [jump]);

  return (
    <div className="reader-page">
      <header className="reader-toolbar">
        <button className="btn-icon" onClick={onBack} aria-label="返回书架" title="返回书架">
          <BackIcon size={18} />
        </button>
        <h2>{book.title}</h2>
        <div className="toolbar-actions">
          <TtsBar />
          <button
            className={`btn-icon${panel === "annotations" ? " active" : ""}`}
            onClick={() => setPanel((p) => (p === "annotations" ? null : "annotations"))}
            aria-label="标注"
            title="标注"
          >
            <HighlightIcon size={17} />
          </button>
          <button
            className={`btn-icon${panel === "bookmarks" ? " active" : ""}`}
            onClick={() => setPanel((p) => (p === "bookmarks" ? null : "bookmarks"))}
            aria-label="书签"
            title="书签"
          >
            <BookmarkIcon size={17} />
          </button>
        </div>
      </header>
      <div className="reader-body">
        <main className="reader-main">
          {openError && (
            <div className="error-box">
              <p>文件缺失或已损坏</p>
              <p className="error-detail">{openError}</p>
              <button className="btn-primary" onClick={handleRemoveBroken}>移除该书</button>
            </div>
          )}
          {!openError && book.format === "epub" && <EpubReader path={book.path} bookId={book.id} onError={setOpenError} />}
          {!openError && book.format === "pdf" && <PdfReader path={book.path} bookId={book.id} onError={setOpenError} />}
          {!openError && book.format === "md" && <MdReader path={book.path} bookId={book.id} onError={setOpenError} />}
          {!openError && book.format === "txt" && <TxtReader path={book.path} bookId={book.id} onError={setOpenError} />}
        </main>
        {panel === "annotations" && (
          <AnnotationPanel bookId={book.id} format={book.format} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
        {panel === "bookmarks" && (
          <BookmarkPanel bookId={book.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
      </div>
    </div>
  );
}
