import { useCallback, useEffect, useRef, useState } from "react";
import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import PaginatedReader from "../readers/PaginatedReader";
import MangaViewer from "../readers/MangaViewer";
import AnnotationPanel from "../components/AnnotationPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import TtsBar from "../components/TtsBar";
import { BackIcon, BookmarkIcon, HighlightIcon, SettingsIcon, TocIcon, SwitchIcon } from "../components/icons";
import { addBookmark, removeBook, httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress, mergeUserAgent, openLoginWindow, listShelfSourceBooks, addShelfSourceBook, removeShelfSourceBook, getCachedChapter, saveCachedChapter } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, purifyContent, isImageChapter, extractImageUrls, type BookSource as Src } from "../services/bookSourceEngine";
import { loadReadingSettings, saveReadingSettings, BG_THEMES, FONT_PRESETS, resolveFontCss, DEFAULT_READING_SETTINGS, type ReadingSettings } from "../services/readingSettings";
import { convertText } from "../services/tradSimpl";
import { fetchToc, type TocItem } from "../services/sourceToc";
import type { SearchHit } from "../services/searchService";
import SwitchSourcePanel from "../components/SwitchSourcePanel";
import { useError } from "../components/ErrorDialog";
import { type ReaderSource } from "../services/reading";
import "./ReaderPage.css";

interface ChapterState { index: number; url: string; name: string }

export default function ReaderPage({ source, onBack, onSwitchSource }: {
  source: ReaderSource; onBack: () => void; onSwitchSource?: (hit: SearchHit) => void;
}) {
  const isLocal = source.kind === "local";
  const book = isLocal ? source.book : null;
  const sourceId = isLocal ? -1 : source.sourceId;
  const bookUrl = isLocal ? "" : source.bookUrl;
  const bookTitle = isLocal ? "" : source.bookTitle;
  const initialChapterIndex = isLocal ? -1 : source.chapterIndex;
  const initialChapterUrl = isLocal ? "" : source.chapterUrl;
  const initialChapterName = isLocal ? "" : source.chapterName;

  // ==== 通用 ====
  const [panel, setPanel] = useState<"annotations" | "bookmarks" | "settings" | "toc" | "switch" | null>(null);
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

  // ==== 阅读设置（书源正文） ====
  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_READING_SETTINGS);
  const persistSettingsTimer = useRef<number | null>(null);
  const updateSetting = useCallback((patch: Partial<ReadingSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (persistSettingsTimer.current) window.clearTimeout(persistSettingsTimer.current);
      persistSettingsTimer.current = window.setTimeout(() => {
        void saveReadingSettings(next).catch(() => {});
      }, 400);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadReadingSettings().then((s) => { if (!cancelled) setSettings(s); });
    return () => { cancelled = true; };
  }, []);

  // ==== 书源：目录（阅读页内跳转） ====
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocFailed, setTocFailed] = useState(false);
  const tocSeqRef = useRef(0);

  const loadToc = useCallback(async () => {
    if (isLocal) return;
    setTocLoading(true); setTocFailed(false);
    const seq = ++tocSeqRef.current;
    try {
      const r = await fetchToc({ sourceId, bookUrl, initialTitle: bookTitle });
      if (seq !== tocSeqRef.current) return;
      setToc(r.toc);
    } catch {
      if (seq !== tocSeqRef.current) return;
      setTocFailed(true);
    } finally {
      if (seq === tocSeqRef.current) setTocLoading(false);
    }
  }, [isLocal, sourceId, bookUrl, bookTitle]);

  useEffect(() => {
    if (!isLocal) void loadToc();
  }, [isLocal, loadToc]);

  const jumpToChapter = useCallback((idx: number, url: string, name: string) => {
    prevUrlsRef.current = [];   // 从目录跳转后上一章从该章节往前
    nextUrlRef.current = "";
    setChapter({ index: idx, url, name });
    setPanel(null);
  }, []);

  // ==== 书源：加入书架 ====
  const [onShelf, setOnShelf] = useState(false);
  const [shelfBusy, setShelfBusy] = useState(false);
  useEffect(() => {
    if (isLocal) return;
    let cancelled = false;
    void listShelfSourceBooks().then((l) => {
      if (!cancelled) setOnShelf(l.some((s) => s.source_id === sourceId && s.book_url === bookUrl));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isLocal, sourceId, bookUrl]);

  const toggleShelf = async () => {
    if (shelfBusy) return;
    setShelfBusy(true);
    try {
      if (onShelf) {
        const l = await listShelfSourceBooks();
        const hit = l.find((s) => s.source_id === sourceId && s.book_url === bookUrl);
        if (hit) await removeShelfSourceBook(hit.id);
        setOnShelf(false);
      } else {
        await addShelfSourceBook({ sourceId, bookUrl, title: bookTitle, author: "", coverUrl: "" });
        setOnShelf(true);
      }
    } catch (e) {
      showError(String(e));
    } finally {
      setShelfBusy(false);
    }
  };

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

  // ==== 书源：加载章节（缓存优先）====
  const loadChapter = useCallback(async (c: ChapterState) => {
    if (!isLocal && c.url) {
      setFailed(false);
      setLoading(true); setContent(""); setImages([]); setIsManga(false);
      try {
        // 1. 缓存优先：命中直接渲染（离线可读）
        const cached = await getCachedChapter(sourceId, bookUrl, c.url);
        if (cached) {
          setContent(cached);
          setLoading(false);
          return;
        }
        // 2. 在线抓取
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
        const text = await extractSingle(doc, rules.content ?? "body", { baseUrl: c.url, result: html, sourceKey: src.bookSourceUrl });
        console.warn("[sourcereader] content len=", text.length, "head=", text.slice(0, 100));
        const next = rules.nextContentUrl ? await extractSingle(doc, rules.nextContentUrl, { baseUrl: c.url, result: html, sourceKey: src.bookSourceUrl }) : "";
        nextUrlRef.current = next;
        const urls = extractImageUrls(text, c.url);
        if (isImageChapter(text) && urls.length !== 1) {
          setImages(urls);
          setIsManga(true);
        } else {
          const purified = purifyContent(text, (src as any).purify);
          setContent(purified);
          // 3. 写缓存（阅读即缓存，供后续离线）
          void saveCachedChapter({
            sourceId, bookUrl, chapterIndex: c.index, chapterUrl: c.url, chapterName: c.name,
            content: purified,
          }).catch(() => {});
        }
        setLoading(false);
      } catch (e) {
        setFailed(true);
        showError(String(e));
        setLoading(false);
      }
    }
  }, [isLocal, sourceId, bookUrl]);

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

  const activeTheme = BG_THEMES.find((t) => t.id === settings.bgTheme) ?? BG_THEMES[0];

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
              <button className="btn btn-ghost" onClick={toggleShelf} disabled={shelfBusy}>
                {onShelf ? "已在书架" : "加入书架"}
              </button>
              {onSwitchSource && (
                <button
                  className={`btn-icon${panel === "switch" ? " active" : ""}`}
                  onClick={() => setPanel((p) => (p === "switch" ? null : "switch"))}
                  aria-label="换源"
                  title="换源"
                >
                  <SwitchIcon size={17} />
                </button>
              )}
              <button
                className={`btn-icon${panel === "toc" ? " active" : ""}`}
                onClick={() => setPanel((p) => (p === "toc" ? null : "toc"))}
                aria-label="目录"
                title="目录"
              >
                <TocIcon size={17} />
              </button>
              <button
                className={`btn-icon${panel === "settings" ? " active" : ""}`}
                onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
                aria-label="阅读设置"
                title="阅读设置"
              >
                <SettingsIcon size={17} />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="reader-body">
        <main
          className="reader-main"
          data-bg-theme={isLocal ? undefined : settings.bgTheme}
          style={!isLocal ? { background: activeTheme.bg } : undefined}
          onClick={isLocal || isManga || !chapter.url || loading || failed ? () => setMenuVisible((v) => !v) : undefined}
        >
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
                  <PaginatedReader
                    html={`<p>${convertText(content, settings.conversion).replace(/\n/g, "</p><p>")}</p>`}
                    mode={settings.pageMode}
                    fontSizePx={settings.fontSizePx}
                    lineHeight={settings.lineHeight}
                    typography={{
                      letterSpacingPx: settings.letterSpacingPx,
                      paragraphSpacingPx: settings.paragraphSpacingPx,
                      indentEm: settings.indentEm,
                      bold: settings.bold,
                      fontFamily: resolveFontCss(settings.fontFamily),
                    }}
                    onMenuToggle={() => setMenuVisible((v) => !v)}
                  />
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
        {!isLocal && panel === "toc" && (
          <div className="panel reader-toc-panel">
            <h3>目录</h3>
            {tocLoading && toc.length === 0 && <p className="panel-empty">加载中…</p>}
            {tocFailed && toc.length === 0 && (
              <div className="panel-empty">
                <p>目录加载失败</p>
                <button className="btn btn-primary" onClick={() => void loadToc()}>重试</button>
              </div>
            )}
            {!tocLoading && !tocFailed && toc.length === 0 && <p className="panel-empty">暂无目录</p>}
            {toc.length > 0 && (
              <ol className="toc-list">
                {toc.map((t, idx) => (
                  <li key={`${t.url}-${idx}`}>
                    <button
                      type="button"
                      className={`toc-item${chapter.index === idx || chapter.url === t.url ? " active" : ""}`}
                      onClick={() => jumpToChapter(idx, t.url, t.name)}
                    >
                      {t.name}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {!isLocal && panel === "switch" && onSwitchSource && (
          <SwitchSourcePanel
            title={bookTitle}
            author=""
            excludeSourceId={sourceId}
            onPick={(hit) => { setPanel(null); onSwitchSource!(hit); }}
            onClose={() => setPanel(null)}
          />
        )}
        {!isLocal && panel === "settings" && (
          <div className="panel reader-settings-panel">
            <h3>阅读设置</h3>
            <div className="settings-group">
              <label className="settings-label">翻页模式</label>
              <div className="segmented" role="group" aria-label="翻页模式">
                {(["scroll", "cover", "slide"] as const).map((m) => (
                  <button key={m} type="button" className={settings.pageMode === m ? "active" : ""}
                    onClick={() => updateSetting({ pageMode: m })}>
                    {{ scroll: "滚动", cover: "覆盖", slide: "滑动" }[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">字号 {settings.fontSizePx}px</label>
              <div className="range-row">
                <input type="range" min={14} max={24} value={settings.fontSizePx} aria-label="字号"
                  onChange={(e) => updateSetting({ fontSizePx: Number(e.target.value) })} />
                <span className="range-value">{settings.fontSizePx}</span>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">行距 {settings.lineHeight.toFixed(1)}</label>
              <div className="range-row">
                <input type="range" min={1.4} max={2.4} step={0.1} value={settings.lineHeight} aria-label="行距"
                  onChange={(e) => updateSetting({ lineHeight: Number(e.target.value) })} />
                <span className="range-value">{settings.lineHeight.toFixed(1)}</span>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">字间距 {settings.letterSpacingPx.toFixed(1)}px</label>
              <div className="range-row">
                <input type="range" min={0} max={4} step={0.1} value={settings.letterSpacingPx} aria-label="字间距"
                  onChange={(e) => updateSetting({ letterSpacingPx: Number(e.target.value) })} />
                <span className="range-value">{settings.letterSpacingPx.toFixed(1)}</span>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">段间距 {settings.paragraphSpacingPx}px</label>
              <div className="range-row">
                <input type="range" min={0} max={24} step={1} value={settings.paragraphSpacingPx} aria-label="段间距"
                  onChange={(e) => updateSetting({ paragraphSpacingPx: Number(e.target.value) })} />
                <span className="range-value">{settings.paragraphSpacingPx}</span>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">首行缩进 {settings.indentEm.toFixed(1)}em</label>
              <div className="range-row">
                <input type="range" min={0} max={2} step={0.1} value={settings.indentEm} aria-label="首行缩进"
                  onChange={(e) => updateSetting({ indentEm: Number(e.target.value) })} />
                <span className="range-value">{settings.indentEm.toFixed(1)}</span>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">加粗</label>
              <div className="segmented" role="group" aria-label="加粗">
                <button type="button" className={!settings.bold ? "active" : ""} onClick={() => updateSetting({ bold: false })}>正常</button>
                <button type="button" className={settings.bold ? "active" : ""} onClick={() => updateSetting({ bold: true })}>加粗</button>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">字体</label>
              <div className="segmented" role="group" aria-label="字体">
                {FONT_PRESETS.map((f) => (
                  <button key={f.id} type="button" className={settings.fontFamily === f.id ? "active" : ""}
                    onClick={() => updateSetting({ fontFamily: f.id })}>{f.name}</button>
                ))}
              </div>
              <input className="font-custom-input" placeholder="自定义字体名（CSS font-family）"
                value={FONT_PRESETS.some((f) => f.id === settings.fontFamily) ? "" : settings.fontFamily}
                onChange={(e) => updateSetting({ fontFamily: e.target.value || "serif" })} aria-label="自定义字体" />
            </div>
            <div className="settings-group">
              <label className="settings-label">背景</label>
              <div className="bg-theme-options">
                {BG_THEMES.map((t) => (
                  <button key={t.id} type="button" className={`bg-theme-swatch${settings.bgTheme === t.id ? " active" : ""}`}
                    style={{ background: t.bg }} aria-label={t.name} title={t.name}
                    onClick={() => updateSetting({ bgTheme: t.id })} />
                ))}
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">简繁</label>
              <div className="segmented" role="group" aria-label="简繁">
                <button type="button" className={settings.conversion === "none" ? "active" : ""}
                  onClick={() => updateSetting({ conversion: "none" })}>原样</button>
                <button type="button" className={settings.conversion === "simp" ? "active" : ""}
                  onClick={() => updateSetting({ conversion: "simp" })}>简体</button>
                <button type="button" className={settings.conversion === "trad" ? "active" : ""}
                  onClick={() => updateSetting({ conversion: "trad" })}>繁体</button>
              </div>
            </div>
          </div>
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
