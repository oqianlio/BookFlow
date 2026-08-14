import { useCallback, useEffect, useRef, useState } from "react";
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import MangaViewer from "../readers/MangaViewer";
import AnnotationPanel from "../components/AnnotationPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import TtsBar from "../components/TtsBar";
import { BackIcon, BookmarkIcon, HighlightIcon } from "../components/icons";
import { addBookmark, removeBook, httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress, mergeUserAgent, openLoginWindow } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, purifyContent, isImageChapter, extractImageUrls, type BookSource as Src } from "../services/bookSourceEngine";
import { useError } from "../components/ErrorDialog";
import { type ReaderSource } from "../services/reading";
import "./ReaderPage.css";

interface ChapterState { index: number; url: string; name: string }

export default function ReaderPage({ source, onBack }: { source: ReaderSource; onBack: () => void }) {
  const isLocal = source.kind === "local";
  const book = isLocal ? source.book : null;
  const sourceId = isLocal ? -1 : source.sourceId;
  const bookUrl = isLocal ? "" : source.bookUrl;
  const bookTitle = isLocal ? "" : source.bookTitle;
  const initialChapterIndex = isLocal ? -1 : source.chapterIndex;
  const initialChapterUrl = isLocal ? "" : source.chapterUrl;
  const initialChapterName = isLocal ? "" : source.chapterName;

  // ==== 通用 ====
  const [panel, setPanel] = useState<"annotations" | "bookmarks" | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(true);
  const { showError } = useError();
  const jumpKey = useRef(0);

  // ==== 书源阅读状态 ====
  const [chapter, setChapter] = useState<ChapterState>({ index: initialChapterIndex, url: initialChapterUrl, name: initialChapterName });
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isManga, setIsManga] = useState(false);
  const [loading, setLoading] = useState(!isLocal);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<Src | null>(null);
  const nextUrlRef = useRef("");
  const prevUrlsRef = useRef<string[]>([]);
  const saveTimer = useRef<number | null>(null);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;

  // ==== 本地书：移除损坏书籍 ====
  const handleRemoveBroken = async () => {
    try {
      await removeBook(book!.id);
    } catch (e) {
      setOpenError(String(e));
      return;
    }
    onBack();
  };

  // ==== 本地书：搜索/标注跳转 ====
  const jump = useCallback((loc: string) => {
    const w = window as any;
    w.__jumpTo = loc;
    jumpKey.current += 1;
    w.dispatchEvent(new CustomEvent("reader-jump", { detail: loc }));
  }, []);

  // ==== 书源：加载章节（现有 loadChapter 逻辑原样迁入）====
  const loadChapter = useCallback(async (c: ChapterState) => {
    if (!isLocal && c.url) {
      setFailed(false);
      setLoading(true); setContent(""); setImages([]); setIsManga(false);
      try {
        const bs = (await listBookSources()).find((x) => x.id === sourceId);
        if (!bs) { setFailed(true); showError("书源不存在"); setLoading(false); return; }
        const src: Src = parseBookSourceJson(bs.json);
        setSrc(src);
        let cookieJarHost = "";
        try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
        const html = await httpGet(c.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
        console.warn("[sourcereader] chapterUrl=", c.url, "len=", html.length, "head=", html.slice(0, 100));
        const doc = parseHtml(html);
        const rules = src.ruleContent ?? {};
        const text = extractSingle(doc, rules.content ?? "body", { baseUrl: c.url, result: html, sourceKey: src.bookSourceUrl });
        console.warn("[sourcereader] content len=", text.length, "head=", text.slice(0, 100));
        const next = rules.nextContentUrl ? extractSingle(doc, rules.nextContentUrl, { baseUrl: c.url, result: html, sourceKey: src.bookSourceUrl }) : "";
        nextUrlRef.current = next;
        const urls = extractImageUrls(text, c.url);
        if (isImageChapter(text) && urls.length !== 1) {
          setImages(urls);
          setIsManga(true);
        } else {
          setContent(purifyContent(text, (src as any).purify));
        }
        setLoading(false);
      } catch (e) {
        setFailed(true);
        showError(String(e));
        setLoading(false);
      }
    }
  }, [isLocal, sourceId, showError]);

  useEffect(() => {
    if (chapter.url) void loadChapter(chapter);
  }, [chapter, loadChapter]);

  // ==== 书源：进度保存 ====
  const persist = useCallback(() => {
    if (isLocal) return;
    const c = chapterRef.current;
    if (!c.url) return;
    void saveBookSourceProgress({
      sourceId, bookUrl, title: bookTitle, chapterIndex: c.index,
      chapterUrl: c.url, chapterName: c.name, percent: 0,
    });
  }, [isLocal, sourceId, bookUrl, bookTitle]);

  // ==== 书源：书源元信息 ====
  useEffect(() => {
    if (isLocal) return;
    let cancelled = false;
    void listBookSources().then((l) => {
      const bs = l.find((x) => x.id === sourceId);
      if (!cancelled && bs) setSrc(parseBookSourceJson(bs.json));
    });
    return () => { cancelled = true; };
  }, [isLocal, sourceId]);

  // ==== 书源：进度恢复 ====
  useEffect(() => {
    if (isLocal || initialChapterIndex !== -1) return;
    let cancelled = false;
    void getBookSourceProgress(sourceId, bookUrl).then((p) => {
      if (cancelled) return;
      if (p) {
        setChapter({ index: p.chapter_index, url: p.chapter_url, name: p.chapter_name });
      } else {
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [isLocal, sourceId, bookUrl, initialChapterIndex]);

  useEffect(() => {
    if (isLocal) return;
    if (!loading) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 800);
    }
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [isLocal, content, loading, persist]);

  // ==== 书源：上一章/下一章 ====
  const goChapter = (delta: number) => {
    const idx = chapter.index + delta;
    if (delta > 0) {
      const next = nextUrlRef.current;
      if (!next) return;
      prevUrlsRef.current.push(chapter.url);
      setChapter({ index: idx, url: next, name: `第 ${idx + 1} 章` });
    } else {
      const prev = prevUrlsRef.current.pop();
      if (!prev) return;
      setChapter({ index: idx, url: prev, name: `第 ${idx + 1} 章` });
    }
  };

  // ==== 本地书：键盘快捷键 ====
  useEffect(() => {
    if (!isLocal) return;
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
          void addBookmark({ bookId: book!.id, location: loc, label: `书签 ${new Date().toLocaleString("zh-CN")}` });
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
  }, [isLocal, book?.id]);

  useEffect(() => {
    if (!isLocal) return;
    const onRequestBookmark = (e: Event) => {
      const w = window as any;
      const detail = (e as CustomEvent).detail as string | undefined;
      const loc = detail || w.__bookmarkLocation || "";
      if (!loc) return;
      void addBookmark({ bookId: book!.id, location: loc, label: `书签 ${new Date().toLocaleString("zh-CN")}` });
      w.dispatchEvent(new CustomEvent("bookmark-changed"));
    };
    window.addEventListener("request-bookmark", onRequestBookmark);
    return () => window.removeEventListener("request-bookmark", onRequestBookmark);
  }, [isLocal, book?.id]);

  useEffect(() => {
    if (!isLocal) return;
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
  }, [isLocal, jump]);

  return (
    <div className="reader-page">
      <header className={`reader-toolbar${menuVisible ? "" : " reader-toolbar-hidden"}`}>
        <button className="btn-icon" onClick={onBack} aria-label="返回" title="返回">
          <BackIcon size={18} />
        </button>
        <h2>
          {isLocal ? book!.title : (
            <span className="reader-title">{bookTitle}</span>
          )}
          {!isLocal && chapter.name && <> · <span className="reader-chapter">{chapter.name}</span></>}
        </h2>
        <div className="toolbar-actions">
          {isLocal ? (
            <>
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
            </>
          ) : (
            <>
              {src?.loginUrl && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (!src?.loginUrl) return;
                    let host = "";
                    try { host = new URL(src.bookSourceUrl).hostname; } catch { host = src.bookSourceUrl; }
                    void openLoginWindow(src.loginUrl, host);
                  }}
                >登录</button>
              )}
            </>
          )}
        </div>
      </header>
      <div className="reader-body">
        <main className="reader-main" onClick={() => setMenuVisible((v) => !v)}>
          {isLocal ? (
            <>
              {openError && (
                <div className="error-box">
                  <p>文件缺失或已损坏</p>
                  <p className="error-detail">{openError}</p>
                  <button className="btn-primary" onClick={handleRemoveBroken}>移除该书</button>
                </div>
              )}
              {!openError && book!.format === "epub" && <EpubReader path={book!.path} bookId={book!.id} onError={setOpenError} />}
              {!openError && book!.format === "pdf" && <PdfReader path={book!.path} bookId={book!.id} onError={setOpenError} />}
              {!openError && book!.format === "md" && <MdReader path={book!.path} bookId={book!.id} onError={setOpenError} />}
              {!openError && book!.format === "txt" && <TxtReader path={book!.path} bookId={book!.id} onError={setOpenError} />}
            </>
          ) : (
            <>
              {loading && (
                <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>加载中…</span></span></p>
              )}
              {!loading && failed && (
                <div className="panel-empty">
                  <p>章节加载失败</p>
                  <button className="btn btn-primary" onClick={() => void loadChapter(chapter)}>重试</button>
                </div>
              )}
              {!loading && !failed && (
                isManga ? (
                  <MangaViewer images={images} />
                ) : chapter.url ? (
                  <div className="md-reader"><div className="md-content" dangerouslySetInnerHTML={{ __html: `<p>${content.replace(/\n/g, "</p><p>")}</p>` }} /></div>
                ) : (
                  <p className="panel-empty">请从目录选择章节</p>
                )
              )}
            </>
          )}
        </main>
        {isLocal && panel === "annotations" && (
          <AnnotationPanel bookId={book!.id} format={book!.format} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
        {isLocal && panel === "bookmarks" && (
          <BookmarkPanel bookId={book!.id} onJump={jump} onChanged={() => jumpKey.current += 1} />
        )}
      </div>
      {!isLocal && (
        <footer className="reader-bottom-bar">
          <button className="btn btn-ghost" onClick={() => goChapter(-1)} disabled={loading || prevUrlsRef.current.length === 0}>上一章</button>
          <span className="reader-progress">第 {chapter.index + 1} 章</span>
          <button className="btn btn-ghost" onClick={() => goChapter(1)} disabled={!!loading || failed || !nextUrlRef.current}>下一章</button>
        </footer>
      )}
    </div>
  );
}
