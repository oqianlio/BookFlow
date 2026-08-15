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
  const [info, setInfo] = useState({ title: initialTitle, author: "", intro: "", coverUrl: "" });
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
      <div className="source-book-info">
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
          {info.author && <span className="hit-author">{info.author}</span>}
          {stats && stats.read_seconds > 0 && (
            <span className="hit-author">
              {formatReadTime(stats.read_seconds)} · 阅读 {stats.read_count} 次
              {stats.last_read_at ? ` · 最近 ${formatDate(stats.last_read_at)}` : ""}
            </span>
          )}
          {info.intro && <p className="source-intro">{info.intro}</p>}
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
        </div>
      </div>
      <div className="source-toc">
        <h2 className="home-section">目录 {toc.length > 0 && <span className="toc-total">共 {toc.length} 章</span>}</h2>
        {toc.length === 0 ? (
          <p className="panel-empty">暂无目录</p>
        ) : (
          <ol>
            {toc.map((t, idx) => (
              <li key={`${t.url}-${idx}`}>
                <button className="btn btn-ghost" onClick={() => onRead(idx, t.url, t.name)}>{t.name}</button>
              </li>
            ))}
          </ol>
        )}
      </div>
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
