import { useEffect, useState } from "react";
import { openLoginWindow } from "../services/api";
import { fetchToc, type TocItem } from "../services/sourceToc";
import { useError } from "../components/ErrorDialog";

export default function SourceBookPage({ sourceId, sourceName, bookUrl, initialTitle, onBack, onRead }: {
  sourceId: number; sourceName: string; bookUrl: string; initialTitle: string;
  onBack: () => void; onRead: (index: number, url: string, name: string) => void;
}) {
  const [info, setInfo] = useState({ title: initialTitle, author: "", intro: "", coverUrl: "" });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loginUrl, setLoginUrl] = useState<string | undefined>(undefined);
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
          <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
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
    </div>
  );
}
