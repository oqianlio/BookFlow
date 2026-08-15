import { useCallback, useEffect, useState } from "react";
import { addRssFeed, deleteRssFeed, listRssArticles, listRssFeeds, refreshRssFeed, type RssArticleRow, type RssFeedRow } from "../services/api";
import { useError } from "../components/ErrorDialog";

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function RssPage({ onOpenArticle }: {
  onOpenArticle: (article: RssArticleRow) => void;
}) {
  const [feeds, setFeeds] = useState<RssFeedRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [articles, setArticles] = useState<RssArticleRow[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { showError } = useError();

  const refreshFeeds = useCallback(async () => {
    try {
      const list = await listRssFeeds();
      setFeeds(list);
      if (list.length > 0 && activeId == null) setActiveId(list[0].id);
    } catch (e) {
      showError(String(e));
    }
  }, [activeId, showError]);

  useEffect(() => { void refreshFeeds(); }, [refreshFeeds]);

  const loadArticles = useCallback(async (feedId: number) => {
    try {
      setArticles(await listRssArticles(feedId));
    } catch (e) {
      showError(String(e));
    }
  }, [showError]);

  useEffect(() => {
    if (activeId != null) void loadArticles(activeId);
  }, [activeId, loadArticles]);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addRssFeed(trimmed);
      setUrl("");
      const list = await listRssFeeds();
      setFeeds(list);
      if (list.length > 0) {
        setActiveId(list[list.length - 1].id);
        void loadArticles(list[list.length - 1].id);
      }
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (feed: RssFeedRow) => {
    if (!window.confirm(`删除订阅源「${feed.title}」？`)) return;
    try {
      await deleteRssFeed(feed.id);
      if (activeId === feed.id) { setActiveId(null); setArticles([]); }
      await refreshFeeds();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleRefresh = async (feed: RssFeedRow) => {
    try {
      const added = await refreshRssFeed(feed.id);
      if (activeId === feed.id) await loadArticles(feed.id);
      if (added > 0) showError(`新增 ${added} 篇文章`); // 复用错误弹窗提示（可接受）
    } catch (e) {
      showError(String(e));
    }
  };

  return (
    <div className="rss-page">
      <header className="library-header">
        <div className="brand"><h1>RSS 订阅</h1></div>
      </header>
      <div className="rss-layout">
        <div className="rss-feeds">
          <h2 className="home-section">订阅源</h2>
          <div className="rss-add">
            <input aria-label="订阅源地址" placeholder="输入 RSS/Atom 地址" value={url}
              onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleAdd()} />
            <button className="btn btn-primary" onClick={handleAdd} disabled={busy || !url.trim()}>添加</button>
          </div>
          {feeds.length === 0 ? (
            <p className="panel-empty">暂无订阅源</p>
          ) : (
            <ul className="rss-feed-list">
              {feeds.map((f) => (
                <li key={f.id} className={`rss-feed-item${activeId === f.id ? " active" : ""}`}>
                  <button className="rss-feed-title" onClick={() => setActiveId(f.id)}>{f.title}</button>
                  <div className="rss-feed-actions">
                    <button className="btn btn-ghost" onClick={() => void handleRefresh(f)}>刷新</button>
                    <button className="btn btn-ghost" onClick={() => void handleDelete(f)}>删除</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rss-articles">
          <h2 className="home-section">文章</h2>
          {activeId == null ? (
            <p className="panel-empty">选择一个订阅源</p>
          ) : articles.length === 0 ? (
            <p className="panel-empty">暂无文章</p>
          ) : (
            <div className="discover-results">
              {articles.map((a) => (
                <div className="hit-card" key={a.id} onClick={() => onOpenArticle(a)}>
                  <div className="hit-info">
                    <span className="hit-title">{a.title}</span>
                    {a.published_at && <span className="hit-author">{formatDate(a.published_at)}</span>}
                  </div>
                  <span className="hit-source">阅读</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
