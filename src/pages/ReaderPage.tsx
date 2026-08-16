import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { addBookmark, removeBook, httpGet, listBookSources, getBookSourceProgress, saveBookSourceProgress, mergeUserAgent, openLoginWindow, listShelfSourceBooks, addShelfSourceBook, removeShelfSourceBook, getCachedChapter, saveCachedChapter, recordRead } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, purifyContent, isImageChapter, extractImageUrls, hostOf, resolveUrl, type BookSource as Src } from "../services/bookSourceEngine";
import { applyInitResult } from "../services/sourceToc";
import { loadReadingSettings, saveReadingSettings, BG_THEMES, FONT_PRESETS, resolveFontCss, DEFAULT_READING_SETTINGS, type ReadingSettings } from "../services/readingSettings";
import { convertText } from "../services/tradSimpl";
import { fetchToc, type TocItem } from "../services/sourceToc";
import { getSessionChapter, setSessionChapter } from "../services/chapterSessionCache";
import type { SearchHit } from "../services/searchService";
import SwitchSourcePanel from "../components/SwitchSourcePanel";
import { useError } from "../components/ErrorDialog";
import { type ReaderSource } from "../services/reading";
import "./ReaderPage.css";

interface ChapterState { index: number; url: string; name: string }

export default function ReaderPage({ source, onBack, onSwitchSource, jumpTo }: {
  source: ReaderSource; onBack: () => void; onSwitchSource?: (hit: SearchHit) => void;
  jumpTo?: string;
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
  const tocRef = useRef<TocItem[]>([]);
  tocRef.current = toc;
  const [author, setAuthor] = useState("");
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
      setAuthor(r.info.author);
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

  // ==== 书源：阅读统计计时 ====
  useEffect(() => {
    if (isLocal) return;
    const t = { start: Date.now(), pending: 0 };
    void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: 0, incrementCount: true }).catch(() => {});
    const hb = window.setInterval(() => {
      const now = Date.now();
      const sec = Math.floor((now - t.start) / 1000) + t.pending;
      t.start = now; t.pending = 0;
      if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
    }, 30000);
    return () => {
      window.clearInterval(hb);
      const sec = Math.floor((Date.now() - t.start) / 1000) + t.pending;
      if (sec > 0) void recordRead({ sourceId, bookUrl, title: bookTitle, seconds: sec, incrementCount: false }).catch(() => {});
    };
  }, [isLocal, sourceId, bookUrl, bookTitle]);

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

  // ==== 书源：章节数据抓取（持久缓存优先 → 网络）====
  // 已解析书源缓存（按 sourceId），避免每章重复 listBookSources + parse + setSrc
  const srcRef = useRef<{ id: number; src: Src } | null>(null);
  const fetchChapterData = useCallback(async (c: ChapterState): Promise<{ content: string; images: string[]; isManga: boolean; nextUrl: string }> => {
    // 1. 持久缓存优先：命中直接渲染（离线可读）
    const cached = await getCachedChapter(sourceId, bookUrl, c.url);
    if (cached) return { content: cached, images: [], isManga: false, nextUrl: "" };
    // 2. 在线抓取
    let parsed = srcRef.current;
    if (!parsed || parsed.id !== sourceId) {
      const bs = (await listBookSources()).find((x) => x.id === sourceId);
      if (!bs) throw new Error("书源不存在");
      parsed = { id: sourceId, src: parseBookSourceJson(bs.json) };
      srcRef.current = parsed;
      setSrc(parsed.src);
    }
    const src = parsed.src;
    const cookieJarHost = hostOf(src.bookSourceUrl);
    const html = await httpGet(c.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
    console.warn("[sourcereader] chapterUrl=", c.url, "len=", html.length, "head=", html.slice(0, 100));
    let doc = parseHtml(html);
    const rules = src.ruleContent ?? {};
    // ruleContent.init（legado JSON 源初始路径）：正文提取相对子对象执行
    let contentResult = applyInitResult(rules.init, html);
    let text = await extractSingle(doc, rules.content ?? "body", { baseUrl: c.url, result: contentResult, sourceKey: src.bookSourceUrl });
    // legado nextContentUrl = 同章节分页（如 36xs 的 6516910_1.html）：循环抓取后续页并拼接，
    // 直到无下一页（或下一页指向目录中的下一章 = 实为"下一章"链接，不拼接）
    let next = rules.nextContentUrl
      ? await extractSingle(doc, rules.nextContentUrl, { baseUrl: c.url, result: contentResult, sourceKey: src.bookSourceUrl })
      : "";
    // 分页判定：分页 URL 与当前 URL 同前缀（36xs: 6516910.html → 6516910_1.html）；
    // 下一章 URL 前缀不同（6516911.html）或与目录下一章一致 → 不拼接
    const isSameChapterPage = (a: string, base: string) =>
      a !== base && a.startsWith(base.replace(/\.html?$/, ""));
    let pageGuard = 0;
    while (next && pageGuard < 20) {
      const nextAbs = resolveUrl(next, c.url);
      const tocNext = tocRef.current[c.index + 1]?.url;
      if (tocNext && nextAbs === tocNext) break; // 指向目录下一章：非分页，停止拼接
      if (!isSameChapterPage(nextAbs, c.url)) break; // 非同章节分页（实为下一章链接）
      pageGuard++;
      const pageHtml = await httpGet(nextAbs, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
      doc = parseHtml(pageHtml);
      const pageResult = applyInitResult(rules.init, pageHtml);
      const pageText = await extractSingle(doc, rules.content ?? "body", { baseUrl: nextAbs, result: pageResult, sourceKey: src.bookSourceUrl });
      if (!pageText) break; // 下一页无正文：停止
      text += pageText;
      const prevNext = next;
      next = rules.nextContentUrl
        ? await extractSingle(doc, rules.nextContentUrl, { baseUrl: nextAbs, result: pageResult, sourceKey: src.bookSourceUrl })
        : "";
      if (next && next === prevNext) break; // 死循环保护：URL 不变
      void console.warn(`[sourcereader] 分页拼接 ${pageGuard}: ${nextAbs} → 累计 ${text.length}`);
    }
    console.warn("[sourcereader] content len=", text.length, "head=", text.slice(0, 100));
    // 下一章判定（优先级）：
    // 1. 目录中的下一章最可靠（tocRef 已加载时）
    // 2. nextContentUrl 的非分页值仅作无目录时的兜底候选，且排除：
    //    - 等于书详情页 URL（错层小说等源最后一章的"下一章"按钮回落书页）
    //    - 等于当前章节 URL
    const tocNext = tocRef.current[c.index + 1]?.url;
    const nextCandidate = next && !isSameChapterPage(resolveUrl(next, c.url), c.url)
      ? resolveUrl(next, c.url)
      : "";
    const nextChapter = tocNext
      ? tocNext
      : (nextCandidate && nextCandidate !== bookUrl && nextCandidate !== c.url ? nextCandidate : "");
    const urls = extractImageUrls(text, c.url);
    if (isImageChapter(text) && urls.length !== 1) {
      return { content: "", images: urls, isManga: true, nextUrl: nextChapter };
    }
    const purified = purifyContent(text, (src as any).purify);
    // 写缓存（阅读即缓存，供后续离线）
    void saveCachedChapter({
      sourceId, bookUrl, chapterIndex: c.index, chapterUrl: c.url, chapterName: c.name,
      content: purified,
    }).catch(() => {});
    return { content: purified, images: [], isManga: false, nextUrl: nextChapter };
  }, [sourceId, bookUrl]);

  // ==== 书源：会话级章节缓存（模块级，App 运行期间跨页面保留已读/预取章节）====
  // 由 chapterSessionCache 提供：重新打开刚看过的书/换源返回时零加载直接显示

  // ==== 书源：后台预取下一章（翻到末页时无缝衔接，无加载闪烁）====
  const prefetchingRef = useRef<Set<string>>(new Set());
  const prefetchChapter = useCallback(async (c: ChapterState) => {
    if (getSessionChapter(sourceId, bookUrl, c.url) || prefetchingRef.current.has(c.url)) return;
    prefetchingRef.current.add(c.url);
    try {
      const data = await fetchChapterData(c);
      setSessionChapter(sourceId, bookUrl, c.url, data);
    } catch {
      // 预取失败静默：翻页时走正常加载
    } finally {
      prefetchingRef.current.delete(c.url);
    }
  }, [fetchChapterData, sourceId, bookUrl]);

  // ==== 书源：加载章节（会话缓存 → 持久缓存 → 网络）====
  // 请求序号：快速翻章时丢弃过期响应，防止旧章节覆盖新章节
  const chapterSeqRef = useRef(0);
  const loadChapter = useCallback(async (c: ChapterState) => {
    if (!isLocal && c.url) {
      // 0. 会话缓存命中：无缝渲染，无 loading
      const mem = getSessionChapter(sourceId, bookUrl, c.url);
      if (mem) {
        nextUrlRef.current = mem.nextUrl;
        if (mem.isManga) { setImages(mem.images); setIsManga(true); setContent(""); }
        else { setContent(mem.content); setIsManga(false); setImages([]); }
        setLoading(false);
        return;
      }
      const seq = ++chapterSeqRef.current;
      setFailed(false);
      setLoading(true); setContent(""); setImages([]); setIsManga(false);
      try {
        const data = await fetchChapterData(c);
        if (seq !== chapterSeqRef.current) return; // 过期响应：已有更新的章节加载
        nextUrlRef.current = data.nextUrl;
        setSessionChapter(sourceId, bookUrl, c.url, data);
        if (data.isManga) { setImages(data.images); setIsManga(true); }
        else { setContent(data.content); }
        setLoading(false);
        // 预取下一章：nextContentUrl 优先，目录兜底
        const nextUrl = data.nextUrl || tocRef.current[c.index + 1]?.url;
        if (nextUrl) {
          const nextName = tocRef.current[c.index + 1]?.name ?? `第 ${c.index + 2} 章`;
          void prefetchChapter({ index: c.index + 1, url: nextUrl, name: nextName });
        }
      } catch (e) {
        if (seq !== chapterSeqRef.current) return;
        setFailed(true);
        showError(String(e));
        setLoading(false);
      }
    }
  }, [isLocal, sourceId, bookUrl, fetchChapterData, prefetchChapter]);

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
    // 章节 URL 也触发保存：快速翻章后即使 content 引用未变（React bail-out）也保证进度落库
  }, [isLocal, content, loading, persist, chapter.url]);

  // ==== 书源：会话缓存命中时同步渲染，实现无缝章节切换（无 loading 闪烁）====
  const applyCachedChapter = useCallback((url: string) => {
    const mem = getSessionChapter(sourceId, bookUrl, url);
    if (!mem) return;
    nextUrlRef.current = mem.nextUrl;
    if (mem.isManga) { setImages(mem.images); setIsManga(true); setContent(""); }
    else { setContent(mem.content); setIsManga(false); setImages([]); }
  }, [sourceId, bookUrl]);

  // ==== 书源：上一章/下一章 ====
  const goChapter = (delta: number) => {
    const idx = chapter.index + delta;
    if (delta > 0) {
      // nextContentUrl 优先；无则从目录取下一章（部分源没有 nextContentUrl 规则）
      const next = nextUrlRef.current;
      const fallback = toc[idx];
      if (!next && !fallback) return;
      const targetUrl = next || fallback!.url;
      const name = fallback?.name ?? `第 ${idx + 1} 章`;
      prevUrlsRef.current.push(chapter.url);
      applyCachedChapter(targetUrl);
      setChapter({ index: idx, url: targetUrl, name });
    } else {
      // 阅读历史栈优先；无历史时从目录取上一章（直接进入章节的场景）
      const prev = prevUrlsRef.current.pop();
      const fallback = toc[idx];
      if (!prev && !fallback) return;
      const targetUrl = prev || fallback!.url;
      const name = fallback?.name ?? `第 ${idx + 1} 章`;
      applyCachedChapter(targetUrl);
      setChapter({ index: idx, url: targetUrl, name });
    }
  };

  // ==== 键盘快捷键（Esc 全局关闭侧栏面板；本地书附加书签/标注快捷键） ====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (!isLocal) return;
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

  // 全文搜索跳转：定位随打开书籍的状态传入（jumpTo prop），转交给当前格式的阅读器（reader-jump 事件）
  useEffect(() => {
    if (!isLocal || !jumpTo) return;
    jump(jumpTo);
  }, [isLocal, jumpTo, jump]);

  const activeTheme = settings.bgTheme === "custom" && settings.customBg
    ? { bg: settings.customBg, fg: settings.customFg || "#1c1b1b" }
    : (BG_THEMES.find((t) => t.id === settings.bgTheme) ?? BG_THEMES[0]);

  // 简繁转换 + HTML 拼装只在内容或转换模式变化时重算，避免每次渲染（切面板/调字号）全量重建
  const convertedHtml = useMemo(
    () => `<p>${convertText(content, settings.conversion).replace(/\n/g, "</p><p>")}</p>`,
    [content, settings.conversion],
  );

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
            </>
          )}
          <button
            className={`btn-icon${panel === "settings" ? " active" : ""}`}
            onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
            aria-label="阅读设置"
            title="阅读设置"
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </header>
      <div className="reader-body">
        <main
          className="reader-main"
          data-bg-theme={settings.bgTheme}
          style={{
            background: activeTheme.bg,
            color: activeTheme.fg,
            ["--read-font-size" as any]: `${settings.fontSizePx}px`,
            ["--read-line-height" as any]: settings.lineHeight,
            ["--read-font-family" as any]: resolveFontCss(settings.fontFamily),
            ["--read-letter-spacing" as any]: `${settings.letterSpacingPx}px`,
            ["--read-para-gap" as any]: `${settings.paragraphSpacingPx}px`,
            ["--read-indent" as any]: `${settings.indentEm}em`,
            ["--read-bold" as any]: settings.bold ? 700 : 400,
            ["--read-fg" as any]: activeTheme.fg,
          }}
          onClickCapture={(e) => {
            // 面板开着：点正文任意处关闭（capture 先于翻页处理，避免同一次点击关面板又翻页）
            if (panel) {
              e.stopPropagation();
              setPanel(null);
            }
          }}
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
              {!openError && book!.format === "epub" && <EpubReader path={book!.path} bookId={book!.id} onError={setOpenError} settings={settings} />}
              {!openError && book!.format === "pdf" && <PdfReader path={book!.path} bookId={book!.id} onError={setOpenError} />}
              {!openError && book!.format === "md" && <MdReader path={book!.path} bookId={book!.id} onError={setOpenError} conversion={settings.conversion} />}
              {!openError && book!.format === "txt" && <TxtReader path={book!.path} bookId={book!.id} onError={setOpenError} conversion={settings.conversion} />}
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
                  <MangaViewer images={images} onReachEnd={() => goChapter(1)} />
                ) : chapter.url ? (
                  <PaginatedReader
                    html={convertedHtml}
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
                    onReachEnd={() => goChapter(1)}
                    onReachStart={() => goChapter(-1)}
                  />
                ) : (
                  <p className="panel-empty">请从目录选择章节</p>
                )
              )}
            </>
          )}
        </main>
        {/* 侧边栏入口：仅面板关闭时显示右缘 ‹ 按钮（贴边小把手，不悬浮遮挡正文） */}
        {!panel && (
          <button
            className="panel-toggle"
            onClick={() => setPanel(isLocal ? "annotations" : "toc")}
            aria-label="展开侧边栏"
            title="展开侧边栏"
          >
            ‹
          </button>
        )}
        {isLocal && panel === "annotations" && (
          <AnnotationPanel bookId={book!.id} format={book!.format} onJump={jump} onChanged={() => jumpKey.current += 1} onClose={() => setPanel(null)} />
        )}
        {isLocal && panel === "bookmarks" && (
          <BookmarkPanel bookId={book!.id} onJump={jump} onChanged={() => jumpKey.current += 1} onClose={() => setPanel(null)} />
        )}
        {!isLocal && panel === "toc" && (
          <div className="panel reader-toc-panel">
            <div className="panel-head">
              <h3>目录</h3>
              <button className="btn-icon panel-close" onClick={() => setPanel(null)} aria-label="关闭目录" title="关闭">×</button>
            </div>
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
            author={author}
            excludeSourceId={sourceId}
            onPick={(hit) => { setPanel(null); onSwitchSource!(hit); }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "settings" && (
          <div className="panel reader-settings-panel">
            <div className="panel-head">
              <h3>阅读设置</h3>
              <button className="btn-icon panel-close" onClick={() => setPanel(null)} aria-label="关闭设置" title="关闭">×</button>
            </div>
            {!isLocal && (
              <div className="settings-group">
                <label className="settings-label">翻页模式</label>
                <div className="segmented" role="group" aria-label="翻页模式">
                  {(["cover", "slide"] as const).map((m) => (
                    <button key={m} type="button" className={settings.pageMode === m ? "active" : ""}
                      onClick={() => updateSetting({ pageMode: m })}>
                      {{ cover: "覆盖", slide: "滑动" }[m]}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                {settings.customBg && (
                  <button type="button"
                    className={`bg-theme-swatch bg-theme-swatch-custom${settings.bgTheme === "custom" ? " active" : ""}`}
                    style={{ background: settings.customBg }} aria-label="自定义" title="自定义"
                    onClick={() => updateSetting({ bgTheme: "custom" })} />
                )}
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
        <footer className={`reader-bottom-bar${menuVisible ? "" : " reader-bottom-bar-hidden"}`}>
          <button className="btn btn-ghost" onClick={() => goChapter(-1)} disabled={loading || (prevUrlsRef.current.length === 0 && !toc[chapter.index - 1])}>上一章</button>
          <span className="reader-progress">第 {chapter.index + 1} 章</span>
          <button className="btn btn-ghost" onClick={() => goChapter(1)} disabled={!!loading || failed || (!nextUrlRef.current && !toc[chapter.index + 1])}>下一章</button>
        </footer>
      )}
    </div>
  );
}
