import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "../components/icons";
import { httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress, mergeUserAgent, openLoginWindow } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, purifyContent, isImageChapter, extractImageUrls, type BookSource as Src } from "../services/bookSourceEngine";
import MangaViewer from "../readers/MangaViewer";
import { useError } from "../components/ErrorDialog";
import "./ReaderPage.css";

interface ChapterState { index: number; url: string; name: string }

export default function SourceReaderPage({ sourceId, bookUrl, bookTitle, initialChapterIndex, initialChapterUrl, initialChapterName, onBack }: {
  sourceId: number; bookUrl: string; bookTitle: string;
  initialChapterIndex: number; initialChapterUrl: string; initialChapterName: string;
  onBack: () => void;
}) {
  const [chapter, setChapter] = useState<ChapterState>({ index: initialChapterIndex, url: initialChapterUrl, name: initialChapterName });
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isManga, setIsManga] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<Src | null>(null);
  const { showError } = useError();
  const nextUrlRef = useRef("");
  const prevUrlsRef = useRef<string[]>([]);
  const saveTimer = useRef<number | null>(null);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;

  const loadChapter = useCallback(async (c: ChapterState) => {
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
  }, [sourceId]);

  useEffect(() => {
    if (chapter.url) void loadChapter(chapter);
  }, [chapter, loadChapter]);

  const persist = useCallback(() => {
    const c = chapterRef.current;
    if (!c.url) return;
    void saveBookSourceProgress({
      sourceId, bookUrl, title: bookTitle, chapterIndex: c.index,
      chapterUrl: c.url, chapterName: c.name, percent: 0,
    });
  }, [sourceId, bookUrl, bookTitle]);

  useEffect(() => {
    let cancelled = false;
    void listBookSources().then((l) => {
      const bs = l.find((x) => x.id === sourceId);
      if (!cancelled && bs) setSrc(parseBookSourceJson(bs.json));
    });
    return () => { cancelled = true; };
  }, [sourceId]);

  useEffect(() => {
    if (initialChapterIndex !== -1) return;
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
  }, [sourceId, bookUrl, initialChapterIndex]);

  useEffect(() => {
    if (!loading) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 800);
    }
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [content, loading, persist]);

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

  return (
    <div className="source-reader reader-page">
      <header className="reader-toolbar">
        <button className="btn-icon" onClick={onBack} aria-label="返回" title="返回"><BackIcon size={18} /></button>
        <h2><span className="reader-title">{bookTitle}</span>{chapter.name && <> · <span className="reader-chapter">{chapter.name}</span></>}</h2>
        <div className="toolbar-actions">
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
          <button className="btn btn-ghost" onClick={() => goChapter(-1)} disabled={loading || prevUrlsRef.current.length === 0}>上一章</button>
          <button className="btn btn-ghost" onClick={() => goChapter(1)} disabled={!!loading || failed || !nextUrlRef.current}>下一章</button>
        </div>
      </header>
      <main className="reader-main">
        {loading && <p className="panel-empty">加载中…</p>}
        {!loading && !failed && (
          isManga ? (
            <MangaViewer images={images} />
          ) : chapter.url ? (
            <div className="md-reader"><div className="md-content" dangerouslySetInnerHTML={{ __html: `<p>${content.replace(/\n/g, "</p><p>")}</p>` }} /></div>
          ) : (
            <p className="panel-empty">请从目录选择章节</p>
          )
        )}
      </main>
    </div>
  );
}
