import { memo, useEffect, useRef, useState } from "react";
import type { Book, ShelfSourceBook } from "../services/api";
import { coverUrl, getProgress, getBookSourceProgress } from "../services/api";
import { fetchToc } from "../services/sourceToc";

export type ShelfItem =
  | { kind: "local"; book: Book }
  | { kind: "source"; sb: ShelfSourceBook };

export function formatLabel(format: string) {
  return format.toUpperCase();
}

function placeholderClass(format: string): string {
  switch (format) {
    case "epub": return "ph-epub";
    case "pdf": return "ph-pdf";
    case "md": return "ph-md";
    case "txt": return "ph-txt";
    default: return "ph-other";
  }
}

function openedAt(item: ShelfItem): number | null {
  return item.kind === "local" ? item.book.last_opened_at : item.sb.last_opened_at;
}

export function formatRelativeTime(ts: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diff = now - ts;
  if (diff < 3600) return "刚刚";
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type BookCardLayout = "grid" | "list" | "compact";

function BookCard({ item, onOpen, onRemove, onInfo, layout = "grid", selectable = false, selected = false, onToggleSelect, onMenu, gridOverlay = false,
  draggable = false, draggingOver = false, onDragStart, onDragOver, onDrop }: {
  item: ShelfItem; onOpen: (item: ShelfItem) => void; onRemove?: (item: ShelfItem) => void;
  onInfo?: (item: ShelfItem) => void;
  layout?: BookCardLayout;
  selectable?: boolean; selected?: boolean;
  onToggleSelect?: (item: ShelfItem) => void;
  onMenu?: (item: ShelfItem, e: React.MouseEvent) => void;
  gridOverlay?: boolean;
  draggable?: boolean;
  draggingOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
}) {
  const title = item.kind === "local" ? item.book.title : item.sb.title;
  const author = item.kind === "source" ? item.sb.author : "";
  const hasUpdate = item.kind === "source" && !!item.sb.has_update;

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const onInfoRef = useRef(onInfo);
  onInfoRef.current = onInfo;
  const onToggleSelectRef = useRef(onToggleSelect);
  onToggleSelectRef.current = onToggleSelect;
  const onMenuRef = useRef(onMenu);
  onMenuRef.current = onMenu;

  const handleActivate = (e?: React.MouseEvent) => {
    if (selectable) {
      e?.stopPropagation();
      onToggleSelectRef.current?.(item);
      return;
    }
    onOpenRef.current(item);
  };

  const [percent, setPercent] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [latestChapter, setLatestChapter] = useState("");

  useEffect(() => {
    if (item.kind !== "local") return;
    let cancelled = false;
    void getProgress(item.book.id)
      .then((p) => { if (!cancelled && p) setPercent(Math.round(p[1] * 100)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.kind, item.kind === "local" ? item.book.id : -1]);

  useEffect(() => {
    if (item.kind !== "source") return;
    let cancelled = false;
    const { source_id: sourceId, book_url: bookUrl, title } = item.sb;
    void Promise.all([
      getBookSourceProgress(sourceId, bookUrl).catch(() => null),
      fetchToc({ sourceId, bookUrl, initialTitle: title }).catch(() => null),
    ]).then(([p, r]) => {
      if (cancelled) return;
      if (p) {
        if (p.chapter_name) setCurrentChapter(p.chapter_name);
        if (p.percent > 0) setPercent(Math.round(p.percent * 100));
      }
      if (r) {
        // 防御：toc 字段缺失或非数组时按空目录处理（部分源/异常响应可能返回不完整结构）
        const toc = Array.isArray(r.toc) ? r.toc : [];
        const last = toc[toc.length - 1];
        if (last) setLatestChapter(last.name);
        // legado getUnreadChapterNum: 总章数 - 当前章 - 1
        const idx = p ? p.chapter_index : -1;
        const unreadNum = Math.max(0, toc.length - (idx + 1));
        if (unreadNum > 0 && p) setUnread(unreadNum);
      }
    });
    return () => { cancelled = true; };
  }, [item.kind, item.kind === "source" ? item.sb.id : -1]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenRef.current(item);
    }
  };

  const opened = openedAt(item);
  const timeStr = opened ? formatRelativeTime(opened) : "";

  let cover: React.ReactNode;
  if (item.kind === "local") {
    cover = item.book.cover_path ? (
      <img className="md3-cover-img" src={coverUrl(item.book.cover_path)} alt={title} loading="lazy" decoding="async" />
    ) : (
      <div className={`md3-cover-placeholder ${placeholderClass(item.book.format)}`}>
        <span>{formatLabel(item.book.format)}</span>
      </div>
    );
  } else {
    cover = item.sb.cover_url ? (
      <img className="md3-cover-img" src={item.sb.cover_url} alt={title} loading="lazy" decoding="async"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
    ) : (
      <div className="md3-cover-placeholder ph-other">
        <span>在线</span>
      </div>
    );
  }

  const typeLabel = item.kind === "local" ? "本地" : "在线";
  // 分类标签（ruleBookInfo.kind，如 "科幻,都市"）
  const kindTags = item.kind === "source" && item.sb.kind
    ? item.sb.kind.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
    : [];
  // 简介（ruleBookInfo.intro，列表单行截断）
  const intro = item.kind === "source"
    ? (item.sb.intro ?? "").replace(/<[^>]*>/g, "").trim()
    : "";

  const dndProps = draggable ? {
    draggable: true,
    onDragStart,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); onDragOver?.(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); onDrop?.(); },
  } : {};
  const dndClass = draggingOver ? " drag-over" : "";

  if (layout === "list") {
    return (
      <div
        className={`md3-card md3-card-list${selected ? " selected" : ""}${selectable ? " selectable" : ""}${dndClass}`}
        onClick={() => handleActivate()}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        aria-label={`${selectable ? "选择" : "打开"} ${title}`}
        {...dndProps}
      >
        <div className="md3-cover-wrap">
          {cover}
          {hasUpdate && <div className="md3-dot-new" title="有新章节" />}
          {unread > 0 && <div className="md3-badge-unread">{unread > 99 ? "99+" : unread}</div>}
          <div className="md3-badge-type">{typeLabel}</div>
        </div>
        <div className="md3-list-content">
          <h3 className="md3-title">{title}</h3>
          {author && <p className="md3-author">{author}</p>}
          {currentChapter && <p className="md3-progress">{currentChapter}</p>}
          {kindTags.length > 0 && (
            <div className="md3-tags-row">
              {kindTags.map((t) => <span key={t} className="md3-tag">{t}</span>)}
            </div>
          )}
          {intro && <p className="md3-intro" title={intro}>{intro}</p>}
          <div className="md3-meta-row">
            {timeStr && <span className="md3-time">{timeStr}</span>}
            {percent != null && percent > 0 && <span className="md3-percent">{percent}%</span>}
            {latestChapter && <span className="md3-latest">{latestChapter}</span>}
          </div>
        </div>
        {onMenu && !selectable && (
          <button
            className="md3-menu-btn"
            onClick={(e) => { e.stopPropagation(); onMenuRef.current?.(item, e); }}
            aria-label="更多操作"
          >⋮</button>
        )}
      </div>
    );
  }

  if (layout === "compact") {
    return (
      <div
        className={`md3-card md3-card-compact${selected ? " selected" : ""}${selectable ? " selectable" : ""}${dndClass}`}
        onClick={() => handleActivate()}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        aria-label={`${selectable ? "选择" : "打开"} ${title}`}
        title={title}
        {...dndProps}
      >
        <div className="md3-cover-wrap">
          {cover}
        </div>
        <p className="md3-title-compact">{title}</p>
        {onMenu && !selectable && (
          <button
            className="md3-menu-btn-compact"
            onClick={(e) => { e.stopPropagation(); onMenuRef.current?.(item, e); }}
            aria-label="更多操作"
          >⋮</button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`md3-card md3-card-grid${selected ? " selected" : ""}${selectable ? " selectable" : ""}${dndClass}`}
      onClick={() => handleActivate()}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      aria-label={`${selectable ? "选择" : "打开"} ${title}`}
      {...dndProps}
    >
      <div className="md3-cover-wrap md3-cover-grid">
        {cover}
        {hasUpdate && <div className="md3-dot-new" title="有新章节" />}
        {unread > 0 && <div className="md3-badge-unread">{unread > 99 ? "99+" : unread}</div>}
        <div className="md3-badge-type">{typeLabel}</div>
        {percent != null && percent > 0 && (
          <div className="md3-badge-tip">{percent}%</div>
        )}
        {onMenu && !selectable && (
          <button
            className="md3-menu-btn-grid"
            onClick={(e) => { e.stopPropagation(); onMenuRef.current?.(item, e); }}
            aria-label="更多操作"
          >⋮</button>
        )}
        {gridOverlay && <p className="md3-title-overlay">{title}</p>}
      </div>
      {!gridOverlay && <p className="md3-title-grid">{title}</p>}
    </div>
  );
}

export default memo(BookCard, (a, b) =>
  a.item === b.item && a.layout === b.layout && a.selectable === b.selectable && a.selected === b.selected && a.onInfo === b.onInfo && a.gridOverlay === b.gridOverlay && a.draggingOver === b.draggingOver);
