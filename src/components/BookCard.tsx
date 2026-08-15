import { memo, useRef } from "react";
import type { Book, ShelfSourceBook } from "../services/api";
import { coverUrl } from "../services/api";

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

function BookCard({ item, onOpen, onRemove }: {
  item: ShelfItem; onOpen: (item: ShelfItem) => void; onRemove?: (item: ShelfItem) => void;
}) {
  const title = item.kind === "local" ? item.book.title : item.sb.title;
  const subLabel = item.kind === "local" ? formatLabel(item.book.format) : item.sb.source_name;

  // 回调用 ref 持有最新引用：memo 只按 item 比较，回调变化不触发重绘但始终使用最新值
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenRef.current(item);
    }
  };

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

  return (
    <div
      className="book-card"
      onClick={() => onOpenRef.current(item)}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      aria-label={`打开 ${title}`}
    >
      {cover}
      <div className="book-meta">
        <h3>{title}</h3>
        <div className="book-sub">
          <span className="fmt">{subLabel}</span>
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

// 书架大列表：仅当 item 引用变化时重渲染（回调经 ref 保持最新）
export default memo(BookCard, (a, b) => a.item === b.item);
