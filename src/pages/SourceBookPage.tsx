import { useEffect, useState } from "react";
import { openLoginWindow, listShelfSourceBooks, addShelfSourceBook, removeShelfSourceBook } from "../services/api";
import { fetchToc, type TocItem } from "../services/sourceToc";
import type { SearchHit } from "../services/searchService";
import SwitchSourcePanel from "../components/SwitchSourcePanel";
import { useError } from "../components/ErrorDialog";

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
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchToc({ sourceId, bookUrl, initialTitle });
        if (!cancelled) {
          setInfo(r.info);
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
          {info.intro && <p className="source-intro">{info.intro}</p>}
          <div className="source-book-actions">
            <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
            <button className="btn btn-ghost" onClick={toggleShelf} disabled={shelfBusy}>
              {onShelf ? "已在书架" : "加入书架"}
            </button>
            {onSwitchSource && (
              <button className="btn btn-ghost" onClick={() => setShowSwitch(true)}>换源</button>
            )}
          </div>
        </div>
      </div>
      <div className="source-toc">
        <h2 className="home-section">目录</h2>
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
