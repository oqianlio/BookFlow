import { useEffect, useRef, useState } from "react";
import { openLoginWindow, listShelfSourceBooks, addShelfSourceBook, removeShelfSourceBook, listBookSources, getReadingStats, type ReadingStats } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { fetchToc, type TocItem } from "../services/sourceToc";
import { downloadBook } from "../services/chapterCache";
import type { SearchHit } from "../services/searchService";
import SwitchSourcePanel from "../components/SwitchSourcePanel";
import { useError } from "../components/ErrorDialog";

function formatReadTime(sec: number): string {
  const min = Math.floor(sec / 60);
  if (min < 1) return `${sec} 秒`;
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} 小时 ${min % 60} 分钟` : `${min} 分钟`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SourceBookPage({ sourceId, sourceName, bookUrl, initialTitle, onBack, onRead, onSwitchSource }: {
  sourceId: number; sourceName: string; bookUrl: string; initialTitle: string;
  onBack: () => void; onRead: (index: number, url: string, name: string) => void;
  onSwitchSource?: (hit: SearchHit) => void;
}) {
  const [info, setInfo] = useState<{
    title: string; author: string; intro: string; coverUrl: string;
    kind?: string; wordCount?: string; lastChapter?: string; status?: string; updateTime?: string;
  }>({ title: initialTitle, author: "", intro: "", coverUrl: "" });
  const [introExpanded, setIntroExpanded] = useState(false);
  const introExpandedRef = useRef(false);
  const introRef = useRef<HTMLParagraphElement | null>(null);
  const [introClampable, setIntroClampable] = useState(false);

  const toggleIntro = () => {
    introExpandedRef.current = !introExpandedRef.current;
    setIntroExpanded(introExpandedRef.current);
  };
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loginUrl, setLoginUrl] = useState<string | undefined>(undefined);
  const [onShelf, setOnShelf] = useState(false);
  const [shelfBusy, setShelfBusy] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [dl, setDl] = useState<{ busy: boolean; done: number; total: number; failed: number }>({ busy: false, done: 0, total: 0, failed: 0 });
  const dlSignalRef = useRef({ cancelled: false });
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const { showError } = useError();

  useEffect(() => () => { dlSignalRef.current.cancelled = true; }, []);

  // 简介是否超过 3 行（决定是否显示"展开/收起"）；只在简介内容变化时测量一次
  useEffect(() => {
    const el = introRef.current;
    if (!el || !info.intro) return;
    el.style.webkitLineClamp = "3";
    const clamped = el.clientHeight;
    el.style.webkitLineClamp = "none";
    const full = el.scrollHeight;
    const clampable = full > clamped + 4;
    setIntroClampable(clampable);
    if (!clampable) {
      // 不满 3 行无需展开按钮
      introExpandedRef.current = true;
      setIntroExpanded(true);
    } else {
      el.style.webkitLineClamp = introExpandedRef.current ? "none" : "3";
    }
  }, [info.intro]);

  useEffect(() => {
    let cancelled = false;
    void getReadingStats(sourceId, bookUrl).then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sourceId, bookUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchToc({ sourceId, bookUrl, initialTitle });
        if (!cancelled) {
          // 书名以用户打开/选中的书名为准（换源后保持同一本书），源解析书名仅作兜底
          setInfo((prev) => ({ ...r.info, title: prev.title || r.info.title || initialTitle }));
          setToc(r.toc);
          setLoginUrl(r.loginUrl);
        }
      } catch (e) {
        if (!cancelled) showError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, bookUrl, initialTitle]);

  useEffect(() => {
    let cancelled = false;
    void listShelfSourceBooks().then((l) => {
      if (!cancelled) setOnShelf(l.some((s) => s.source_id === sourceId && s.book_url === bookUrl));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sourceId, bookUrl]);

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
        await addShelfSourceBook({ sourceId, bookUrl, title: info.title, author: info.author, coverUrl: info.coverUrl });
        setOnShelf(true);
      }
    } catch (e) {
      showError(String(e));
    } finally {
      setShelfBusy(false);
    }
  };

  const handleDownload = async () => {
    if (dl.busy || toc.length === 0) return;
    dlSignalRef.current = { cancelled: false };
    setDl({ busy: true, done: 0, total: toc.length, failed: 0 });
    try {
      const row = (await listBookSources()).find((x) => x.id === sourceId);
      if (!row) { showError("书源不存在"); setDl((p) => ({ ...p, busy: false })); return; }
      const src = parseBookSourceJson(row.json);
      await downloadBook({
        sourceId, bookUrl, toc,
        getSrc: async () => src,
        onProgress: (p) => setDl({ busy: true, done: p.done, total: p.total, failed: p.failed }),
        signal: dlSignalRef.current,
      });
    } catch (e) {
      showError(String(e));
    } finally {
      setDl((p) => ({ ...p, busy: false }));
    }
  };

  const handleLogin = () => {
    if (!loginUrl) return;
    let host = "";
    try { host = new URL(loginUrl).hostname; } catch { host = loginUrl; }
    void openLoginWindow(loginUrl, host);
  };

  return (
    <div className="source-book page">
      <header className="library-header">
        <div className="brand"><h1>{sourceName}</h1></div>
        <div className="library-actions">
          {loginUrl && <button className="btn btn-ghost" onClick={handleLogin}>登录</button>}
          <button className="btn btn-ghost" onClick={onBack}>返回</button>
        </div>
      </header>

      {/* 头图区：封面背景模糊 + 前景封面/书名/作者/标签（参考 legado 详情页） */}
      <div className="source-book-hero">
        {info.coverUrl && (
          <div
            className="source-book-hero-bg"
            style={{ backgroundImage: `url(${info.coverUrl})` }}
            aria-hidden
          />
        )}
        <div className="source-book-hero-inner">
          {info.coverUrl ? (
            <img
              className="source-book-cover"
              src={info.coverUrl}
              alt={info.title || "封面"}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="source-book-cover-ph" aria-hidden />
          )}
          <div className="source-book-meta">
            <h2 className="source-book-title">{info.title || sourceName}</h2>
            <div className="source-book-sub">
              {info.author && <span className="source-book-author">{info.author}</span>}
              <span className="source-book-source">{sourceName}</span>
              {info.kind && <span className="source-book-kind">{info.kind}</span>}
            </div>
            <div className="source-book-tags">
              {info.status && (
                <span className={`tag status-tag${/完/.test(info.status) ? " done" : ""}`}>{info.status}</span>
              )}
              {info.wordCount && <span className="tag">{info.wordCount}</span>}
              {info.updateTime && <span className="tag">更新 {info.updateTime}</span>}
              {stats && stats.read_seconds > 0 && (
                <span className="tag">
                  {formatReadTime(stats.read_seconds)} · 阅读 {stats.read_count} 次
                  {stats.last_read_at ? ` · 最近 ${formatDate(stats.last_read_at)}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 操作行：开始阅读 + 加入书架为主，缓存/换源为辅 */}
      <div className="source-book-actions">
        <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
        <button className="btn btn-ghost" onClick={toggleShelf} disabled={shelfBusy}>
          {onShelf ? "已在书架" : "加入书架"}
        </button>
        {onSwitchSource && (
          <button className="btn btn-ghost" onClick={() => setShowSwitch(true)}>换源</button>
        )}
        <button className="btn btn-ghost" onClick={handleDownload} disabled={dl.busy || toc.length === 0}>
          {dl.busy ? `缓存中 ${dl.done}/${dl.total}` : dl.done === dl.total && dl.total > 0 ? `已缓存 ${dl.total} 章` : "缓存全书"}
        </button>
      </div>

      {/* 简介（可展开） */}
      {info.intro && (
        <div className="source-book-intro">
          <p
            ref={introRef}
            className={`source-intro${introExpanded ? " expanded" : ""}`}
            style={{ WebkitLineClamp: introExpanded ? undefined : 3 }}
          >
            {info.intro}
          </p>
          {introClampable && (
            <button className="btn btn-ghost intro-toggle" onClick={toggleIntro}>
              {introExpanded ? "收起" : "展开"}
            </button>
          )}
        </div>
      )}

      {/* 最新章节：源规则 lastChapter 优先，无则用目录最后一章兜底 */}
      {(info.lastChapter || toc[toc.length - 1]?.name) && (
        <div className="source-book-last">
          <span className="last-label">最新章节</span>
          <span className="last-name">{info.lastChapter || toc[toc.length - 1]!.name}</span>
        </div>
      )}

      {showSwitch && onSwitchSource && (
        <SwitchSourcePanel
          title={info.title || initialTitle}
          author={info.author}
          excludeSourceId={sourceId}
          onPick={(hit) => { setShowSwitch(false); onSwitchSource!(hit); }}
          onClose={() => setShowSwitch(false)}
        />
      )}
    </div>
  );
}
