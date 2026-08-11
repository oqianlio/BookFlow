import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "../components/icons";
import { httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress, mergeUserAgent, openLoginWindow } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, purifyContent, isImageChapter, extractImageUrls, type BookSource as Src } from "../services/bookSourceEngine";
import MangaViewer from "../readers/MangaViewer";
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
  const [error, setError] = useState<string | null>(null);
  const nextUrlRef = useRef("");
  const prevUrlsRef = useRef<string[]>([]);
  const saveTimer = useRef<number | null>(null);
  const srcRef = useRef<Src | null>(null);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;

  const loadChapter = useCallback(async (c: ChapterState) => {
    setLoading(true); setError(null); setContent(""); setImages([]); setIsManga(false);
    try {
      const bs = (await listBookSources()).find((x) => x.id === sourceId);
      if (!bs) { setError("书源不存在"); setLoading(false); return; }
      const src: Src = parseBookSourceJson(bs.json);
      srcRef.current = src;
      const html = await httpGet(c.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined);
      const doc = parseHtml(html);
      const rules = src.ruleContent ?? {};
      const text = extractSingle(doc, rules.content ?? "body", { baseUrl: c.url, result: html });
      const next = rules.nextContentUrl ? extractSingle(doc, rules.nextContentUrl, { baseUrl: c.url }) : "";
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
      setError(String(e));
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
          {srcRef.current?.loginUrl && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                const src = srcRef.current;
                if (!src?.loginUrl) return;
                let host = "";
                try { host = new URL(src.bookSourceUrl).hostname; } catch { host = src.bookSourceUrl; }
                void openLoginWindow(src.loginUrl, host);
              }}
            >登录</button>
          )}
          <button className="btn btn-ghost" onClick={() => goChapter(-1)} disabled={loading || prevUrlsRef.current.length === 0}>上一章</button>
          <button className="btn btn-ghost" onClick={() => goChapter(1)} disabled={!!loading || !!error || !nextUrlRef.current}>下一章</button>
        </div>
      </header>
      <main className="reader-main">
        {loading && <p className="panel-empty">加载中…</p>}
        {error && (
          <div className="panel-empty">
            <p className="error">{error}</p>
            <button className="btn btn-ghost" onClick={() => void loadChapter(chapter)}>重试</button>
          </div>
        )}
        {!loading && !error && (
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
