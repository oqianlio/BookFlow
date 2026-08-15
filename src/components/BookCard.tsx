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

/** 相对时间：刚刚 / N 小时前 / N 天前 / 具体日期 */
export function formatRelativeTime(ts: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diff = now - ts;
  if (diff < 3600) return "刚刚";
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type BookCardLayout = "grid" | "list";

function BookCard({ item, onOpen, onRemove, layout = "grid" }: {
  item: ShelfItem; onOpen: (item: ShelfItem) => void; onRemove?: (item: ShelfItem) => void;
  layout?: BookCardLayout;
}) {
  const title = item.kind === "local" ? item.book.title : item.sb.title;
  // 副行左侧：本地书显示格式标签，在线书统一显示「在线」（不暴露具体书源）
  const subLabel = item.kind === "local" ? formatLabel(item.book.format) : "在线";

  // 回调用 ref 持有最新引用：memo 只按 item 比较，回调变化不触发重绘但始终使用最新值
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;

  // 本地书阅读进度（懒加载，读完显示百分比 + 封面进度条）
  const [percent, setPercent] = useState<number | null>(null);
  useEffect(() => {
    if (item.kind !== "local") return;
    let cancelled = false;
    void getProgress(item.book.id)
      .then((p) => { if (!cancelled && p) setPercent(Math.round(p[1] * 100)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.kind, item.kind === "local" ? item.book.id : -1]);

  // 书源书：阅读进度（进度表）+ 当前章节 + 最新章节（目录最后一项）
  const [currentChapter, setCurrentChapter] = useState("");
  const [latestChapter, setLatestChapter] = useState("");
  useEffect(() => {
    if (item.kind !== "source") return;
    let cancelled = false;
    const { source_id: sourceId, book_url: bookUrl, title } = item.sb;
    void getBookSourceProgress(sourceId, bookUrl)
      .then((p) => {
        if (cancelled || !p) return;
        if (p.chapter_name) setCurrentChapter(p.chapter_name);
        if (p.percent > 0) setPercent(Math.round(p.percent * 100));
      })
      .catch(() => {});
    void fetchToc({ sourceId, bookUrl, initialTitle: title })
      .then((r) => {
        const last = r.toc[r.toc.length - 1];
        if (!cancelled && last) setLatestChapter(last.name);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.kind, item.kind === "source" ? item.sb.id : -1]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenRef.current(item);
    }
  };

  const opened = openedAt(item);
  const extra = percent != null && percent > 0 ? `${percent}%` : (opened ? formatRelativeTime(opened) : null);

  let cover: React.ReactNode;
  if (item.kind === "local") {
    cover = item.book.cover_path ? (
      <img className="book-cover" src={coverUrl(item.book.cover_path)} alt={title} loading="lazy" decoding="async" />
    ) : (
      <div className={`book-cover book-cover-placeholder ${placeholderClass(item.book.format)}`}>
        <span>{formatLabel(item.book.format)}</span>
        <span className="ph-rule" />
      </div>
    );
  } else {
    cover = item.sb.cover_url ? (
      <img className="book-cover" src={item.sb.cover_url} alt={title} loading="lazy" decoding="async"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
    ) : (
      <div className="book-cover book-cover-placeholder ph-other">
        <span>在线</span>
        <span className="ph-rule" />
      </div>
    );
  }

  if (layout === "list") {
    return (
      <div
        className="book-card book-card-list"
        onClick={() => onOpenRef.current(item)}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        aria-label={`打开 ${title}`}
      >
        <div className="book-cover-wrap book-list-cover">
          {cover}
        </div>
        <div className="book-list-meta">
          <h3>{title}</h3>
          {(currentChapter || latestChapter) && (
            <div className="book-chapter">
              {currentChapter && <span>读到 {currentChapter}</span>}
              {currentChapter && latestChapter && <span className="chapter-sep">·</span>}
              {latestChapter && <span>最新 {latestChapter}</span>}
            </div>
          )}
          <div className="book-sub">
            <span className="fmt">{subLabel}</span>
            {extra && <span className="progress">{extra}</span>}
          </div>
        </div>
        {onRemove && (
          <button
            className="book-remove"
            onClick={(e) => { e.stopPropagation(); onRemoveRef.current?.(item); }}
            aria-label={`删除 ${title}`}
          >×</button>
        )}
      </div>
    );
  }

  return (
    <div
      className="book-card"
      onClick={() => onOpenRef.current(item)}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      aria-label={`打开 ${title}`}
    >
      <div className="book-cover-wrap">
        {cover}
      </div>
      <div className="book-meta">
        <h3>{title}</h3>
        {percent != null && percent > 0 && (
          <div className="book-sub">
            <span className="progress">{percent}%</span>
          </div>
        )}
      </div>
      {onRemove && (
        <button
          className="book-remove"
          onClick={(e) => { e.stopPropagation(); onRemoveRef.current?.(item); }}
          aria-label={`删除 ${title}`}
        >×</button>
      )}
    </div>
  );
}

// 书架大列表：仅当 item/layout 引用变化时重渲染（回调经 ref 保持最新）
export default memo(BookCard, (a, b) => a.item === b.item && a.layout === b.layout);
