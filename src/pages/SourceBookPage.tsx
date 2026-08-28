import { useEffect, useRef, useState } from "react";
import { openLoginWindow, listShelfSourceBooks, addShelfSourceBook, removeShelfSourceBook, listBookSources, listShelfGroups, listShelfGroupMembers, addShelfGroupMembers, removeShelfGroupMembers, type ShelfGroup } from "../services/api";
import { parseBookSourceJson, hostOf } from "../services/bookSourceEngine";
import { fetchToc, type TocItem } from "../services/sourceToc";
import { downloadBook } from "../services/chapterCache";
import type { SearchHit } from "../services/searchService";
import SwitchSourcePanel from "../components/SwitchSourcePanel";
import { useError } from "../components/ErrorDialog";

export default function SourceBookPage({ sourceId, sourceName, bookUrl, initialTitle, onBack, onRead, onSwitchSource, onSearchAuthor, onEditSource }: {
  sourceId: number; sourceName: string; bookUrl: string; initialTitle: string;
  onBack: () => void; onRead: (index: number, url: string, name: string) => void;
  onSwitchSource?: (hit: SearchHit) => void;
  onSearchAuthor?: (author: string) => void;
  onEditSource?: (sourceId: number, sourceName: string) => void;
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
  const [showTocDialog, setShowTocDialog] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | undefined>(undefined);
  const [onShelf, setOnShelf] = useState(false);
  const [shelfBusy, setShelfBusy] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [shelfGroups, setShelfGroups] = useState<string[]>([]);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [allGroups, setAllGroups] = useState<ShelfGroup[]>([]);
  const [shelfItemId, setShelfItemId] = useState<number | null>(null);
  const [dl, setDl] = useState<{ busy: boolean; done: number; total: number; failed: number }>({ busy: false, done: 0, total: 0, failed: 0 });
  const dlSignalRef = useRef({ cancelled: false });
  const { showError } = useError();

  useEffect(() => () => { dlSignalRef.current.cancelled = true; }, []);

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
      introExpandedRef.current = true;
      setIntroExpanded(true);
    } else {
      el.style.webkitLineClamp = introExpandedRef.current ? "none" : "3";
    }
  }, [info.intro]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchToc({ sourceId, bookUrl, initialTitle });
        if (!cancelled) {
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
      if (cancelled) return;
      const hit = l.find((s) => s.source_id === sourceId && s.book_url === bookUrl);
      if (!hit) return;
      setOnShelf(true);
      setShelfItemId(hit.id);
      // 查询所属分组
      void listShelfGroups().then(async (groups) => {
        if (cancelled) return;
        setAllGroups(groups);
        const names: string[] = [];
        for (const g of groups) {
          const members = await listShelfGroupMembers(g.id);
          if (members.some((m) => m.item_kind === "source" && m.item_id === hit.id)) {
            names.push(g.name);
          }
        }
        if (!cancelled) setShelfGroups(names);
      }).catch(() => {});
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
        setShelfItemId(null);
        setShelfGroups([]);
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

  const openGroupDialog = async () => {
    try {
      const groups = await listShelfGroups();
      setAllGroups(groups);
      setShowGroupDialog(true);
    } catch (e) {
      showError(String(e));
    }
  };

  const toggleGroup = async (groupId: number, groupName: string) => {
    if (!shelfItemId) return;
    try {
      if (shelfGroups.includes(groupName)) {
        await removeShelfGroupMembers(groupId, [{ item_kind: "source", item_id: shelfItemId }]);
        setShelfGroups((prev) => prev.filter((g) => g !== groupName));
      } else {
        await addShelfGroupMembers(groupId, [{ item_kind: "source", item_id: shelfItemId }]);
        setShelfGroups((prev) => [...prev, groupName]);
      }
    } catch (e) {
      showError(String(e));
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
    void openLoginWindow(loginUrl, hostOf(loginUrl));
  };

  const latestChapter = info.lastChapter || toc[toc.length - 1]?.name;
  const groups = info.kind ? info.kind.split(/\n|,/).filter((s) => s.trim()).map((s) => s.trim()) : [];

  return (
    <div className="source-book page">
      <header className="library-header source-book-header">
        <button className="btn btn-ghost" onClick={onBack}>‹ 返回</button>
        <div className="library-actions">
          {loginUrl && <button className="btn btn-ghost" onClick={handleLogin}>登录</button>}
        </div>
      </header>

      {/* 头图区：封面 + 标题 + 标签 + 次要信息 */}
      <div className="source-book-hero">
        {info.coverUrl ? (
          <img
            className="source-book-cover"
            src={info.coverUrl}
            alt={info.title || "封面"}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="source-book-cover-ph" aria-hidden>{(info.title || sourceName).trim().charAt(0)}</div>
        )}
        <div className="source-book-meta">
          <h2 className="source-book-title">{info.title || sourceName}</h2>
          {info.author && (
            <button
              type="button"
              className="source-book-author"
              onClick={() => onSearchAuthor?.(info.author.replace(/^作者[：:]\s*/, ""))}
              title="搜索该作者的作品"
            >
              {info.author.replace(/^作者[：:]\s*/, "")}
            </button>
          )}
          {(info.status || groups.length > 0) && (
            <div className="source-book-tags">
              {info.status && <span className={`source-tag status ${/完/.test(info.status) ? "done" : "serial"}`}>{info.status}</span>}
              {groups.slice(0, 4).map((t, i) => (<span className="source-tag" key={`kind-${i}`}>{t}</span>))}
            </div>
          )}
          <div className="source-book-submeta">
            <button type="button" className="submeta-source" onClick={() => onEditSource?.(sourceId, sourceName)} title="编辑书源">{sourceName}</button>
            {info.wordCount && <span className="submeta-dot" aria-hidden />}
            {info.wordCount && <span>{info.wordCount}</span>}
            {info.updateTime && <span className="submeta-dot" aria-hidden />}
            {info.updateTime && <><span className="submeta-lbl">更新</span><span>{info.updateTime}</span></>}
          </div>
          {onShelf ? (
            shelfGroups.length > 0 ? (
              <div className="source-book-tags shelf-groups">
                {shelfGroups.map((g, i) => (<span className="source-tag group" key={`shelf-${i}`}>{g}</span>))}
                <button type="button" className="source-tag-add" onClick={openGroupDialog}>+</button>
              </div>
            ) : (
              <button type="button" className="source-tag-add solo" onClick={openGroupDialog}>+ 添加分组</button>
            )
          ) : (
            <span className="shelf-hint">加入书架后可管理分组</span>
          )}
        </div>
      </div>

      {/* 目录卡片 */}
      {(toc.length > 0 || latestChapter) && (
        <button
          type="button"
          className={`source-book-catalog${toc.length === 0 ? " disabled" : ""}`}
          onClick={() => toc.length > 0 && setShowTocDialog(true)}
          disabled={toc.length === 0}
        >
          <span className="catalog-count">
            目录{toc.length > 0 ? ` · ${toc.length} 章` : ""}
          </span>
          {latestChapter && (
            <span className="catalog-latest">
              <span className="catalog-latest-label">最新</span>
              <span className="catalog-latest-name">{latestChapter}</span>
            </span>
          )}
          {toc.length > 0 && <span className="catalog-chevron" aria-hidden>›</span>}
        </button>
      )}

      {/* 简介 */}
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
            <button className="intro-toggle" onClick={toggleIntro}>
              {introExpanded ? "收起" : "展开"}
            </button>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="source-book-actions">
        <button className="btn btn-primary source-btn-read" onClick={() => onRead(-1, "", "")}>开始阅读</button>
        <button className="btn source-btn-shelf" onClick={toggleShelf} disabled={shelfBusy}>
          {onShelf ? "已在书架 ✓" : "+ 加入书架"}
        </button>
        {onShelf && (
          <button className="btn source-btn-dl" onClick={() => void handleDownload()} disabled={dl.busy || toc.length === 0}>
            {dl.busy ? `下载中 ${dl.done}/${dl.total}` : "下载离线"}
          </button>
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

      {showGroupDialog && (
        <div className="error-dialog-overlay" onClick={() => setShowGroupDialog(false)}>
          <div className="group-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>管理分组</h3>
            <div className="group-dialog-list">
              {allGroups.map((g) => (
                <label key={g.id} className="group-dialog-item">
                  <input
                    type="checkbox"
                    checked={shelfGroups.includes(g.name)}
                    onChange={() => toggleGroup(g.id, g.name)}
                  />
                  <span>{g.name}</span>
                </label>
              ))}
              {allGroups.length === 0 && <p className="group-dialog-empty">暂无分组，请先在书架中创建分组</p>}
            </div>
            <div className="group-dialog-actions">
              <button className="btn btn-ghost" onClick={() => setShowGroupDialog(false)}>完成</button>
            </div>
          </div>
        </div>
      )}

      {showTocDialog && (
        <div className="error-dialog-overlay" onClick={() => setShowTocDialog(false)}>
          <div className="toc-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="toc-dialog-header">
              <h3>目录（共 {toc.length} 章）</h3>
              <button className="btn btn-ghost" onClick={() => setShowTocDialog(false)}>关闭</button>
            </div>
            <div className="toc-dialog-list">
              {toc.map((t, idx) => (
                <button key={`${t.url}-${idx}`} className="toc-dialog-item" onClick={() => { onRead(idx, t.url, t.name); setShowTocDialog(false); }}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
