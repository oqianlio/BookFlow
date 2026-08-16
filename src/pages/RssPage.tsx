import { useCallback, useEffect, useRef, useState } from "react";
import {
  addRssFeed, deleteRssFeed, listRssArticles, listRssFeeds, refreshRssFeed,
  markRssArticleRead, markRssFeedRead, rssUnreadCount, exportRssOpml, importRssOpml,
  type RssArticleRow, type RssFeedRow,
} from "../services/api";
import { useError } from "../components/ErrorDialog";
import ConfirmDialog from "../components/ConfirmDialog";

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function RssPage({ onOpenArticle }: {
  onOpenArticle: (article: RssArticleRow) => void;
}) {
  const [feeds, setFeeds] = useState<RssFeedRow[]>([]);
  const [unread, setUnread] = useState<Map<number, number>>(new Map());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [articles, setArticles] = useState<RssArticleRow[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { showError } = useError();

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const refreshFeeds = useCallback(async () => {
    try {
      const list = await listRssFeeds();
      setFeeds(list);
      // 每个源的未读数
      const unreadMap = new Map<number, number>();
      await Promise.all(list.map(async (f) => {
        try { unreadMap.set(f.id, await rssUnreadCount(f.id)); } catch { /* 忽略单源失败 */ }
      }));
      setUnread(unreadMap);
      if (list.length > 0 && activeId == null) setActiveId(list[0].id);
    } catch (e) {
      showError(String(e));
    }
  }, [activeId, showError]);

  useEffect(() => { void refreshFeeds(); }, [refreshFeeds]);

  const loadArticles = useCallback(async (feedId: number) => {
    setArticlesLoading(true);
    try {
      setArticles(await listRssArticles(feedId));
    } catch (e) {
      showError(String(e));
    } finally {
      setArticlesLoading(false);
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
      await refreshFeeds();
      const list = await listRssFeeds();
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

  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const pendingDeleteRef = useRef<RssFeedRow | null>(null);

  const handleDelete = (feed: RssFeedRow) => {
    pendingDeleteRef.current = feed;
    setConfirmMsg(`删除订阅源「${feed.title}」？`);
  };

  const doDelete = async () => {
    const feed = pendingDeleteRef.current;
    setConfirmMsg(null);
    pendingDeleteRef.current = null;
    if (!feed) return;
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
      await refreshFeeds();
      if (added > 0) flash(`新增 ${added} 篇文章`);
    } catch (e) {
      showError(String(e));
    }
  };

  const handleOpenArticle = async (a: RssArticleRow) => {
    // 打开即标记已读（乐观更新）
    if (!a.is_read) {
      void markRssArticleRead(a.id, true).catch(() => {});
      setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_read: true } : x)));
      setUnread((prev) => {
        const next = new Map(prev);
        next.set(a.feed_id, Math.max(0, (next.get(a.feed_id) ?? 1) - 1));
        return next;
      });
    }
    onOpenArticle(a);
  };

  const handleMarkFeedRead = async (feed: RssFeedRow) => {
    await markRssFeedRead(feed.id);
    setUnread((prev) => new Map(prev).set(feed.id, 0));
    if (activeId === feed.id) await loadArticles(feed.id);
  };

  const handleExportOpml = async () => {
    try {
      const opml = await exportRssOpml();
      // 下载到本地文件
      const blob = new Blob([opml], { type: "application/xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "rss-subscriptions.opml";
      a.click();
      URL.revokeObjectURL(a.href);
      flash("已导出 OPML");
    } catch (e) {
      showError(String(e));
    }
  };

  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportOpml = async (file: File) => {
    try {
      const text = await file.text();
      const added = await importRssOpml(text);
      await refreshFeeds();
      flash(`OPML 导入完成，新增 ${added} 个订阅`);
    } catch (e) {
      showError(String(e));
    }
  };

  return (
    <div className="rss-page">
      <header className="library-header">
        <div className="brand"><h1>RSS 订阅</h1></div>
        <div className="library-actions">
          <button className="btn btn-ghost" onClick={() => void handleExportOpml()}>导出 OPML</button>
          <button className="btn btn-ghost" onClick={() => importFileRef.current?.click()}>导入 OPML</button>
          <input
            ref={importFileRef} type="file" accept=".opml,.xml" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportOpml(f); e.target.value = ""; }}
            aria-label="导入 OPML 文件"
          />
        </div>
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
              {feeds.map((f) => {
                const n = unread.get(f.id) ?? 0;
                return (
                  <li key={f.id} className={`rss-feed-item${activeId === f.id ? " active" : ""}`}>
                    <button className="rss-feed-title" onClick={() => setActiveId(f.id)}>
                      {f.title}
                      {n > 0 && <span className="rss-unread-badge">{n}</span>}
                    </button>
                    <div className="rss-feed-actions">
                      <button className="btn btn-ghost" onClick={() => void handleMarkFeedRead(f)}>全部已读</button>
                      <button className="btn btn-ghost" onClick={() => void handleRefresh(f)}>刷新</button>
                      <button className="btn btn-ghost" onClick={() => void handleDelete(f)}>删除</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rss-articles">
          <h2 className="home-section">文章</h2>
          {notice && <p className="rss-notice">{notice}</p>}
          {activeId == null ? (
            <p className="panel-empty">选择一个订阅源</p>
          ) : articlesLoading ? (
            <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>加载中…</span></span></p>
          ) : articles.length === 0 ? (
            <p className="panel-empty">暂无文章</p>
          ) : (
            <div className="discover-results">
              {articles.map((a) => (
                <div className={`hit-card${a.is_read ? " read" : ""}`} key={a.id} onClick={() => void handleOpenArticle(a)}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void handleOpenArticle(a); } }}>
                  <div className="hit-info">
                    <span className="hit-title">{!a.is_read && <span className="rss-dot" aria-label="未读" />}{a.title}</span>
                    {a.published_at && <span className="hit-author">{formatDate(a.published_at)}</span>}
                  </div>
                  <span className="hit-source">阅读</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {confirmMsg && (
        <ConfirmDialog
          message={confirmMsg}
          onConfirm={() => void doDelete()}
          onCancel={() => { setConfirmMsg(null); pendingDeleteRef.current = null; }}
        />
      )}
    </div>
  );
}
