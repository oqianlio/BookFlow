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

export default function BookCard({ item, onOpen, onRemove }: {
  item: ShelfItem; onOpen: (item: ShelfItem) => void; onRemove?: (item: ShelfItem) => void;
}) {
  const title = item.kind === "local" ? item.book.title : item.sb.title;
  const subLabel = item.kind === "local" ? formatLabel(item.book.format) : item.sb.source_name;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(item);
    }
  };

  let cover: React.ReactNode;
  if (item.kind === "local") {
    cover = item.book.cover_path ? (
      <img className="book-cover" src={coverUrl(item.book.cover_path)} alt={title} />
    ) : (
      <div className={`book-cover book-cover-placeholder ${placeholderClass(item.book.format)}`}>
        <span>{formatLabel(item.book.format)}</span>
        <span className="ph-rule" />
      </div>
    );
  } else {
    cover = item.sb.cover_url ? (
      <img className="book-cover" src={item.sb.cover_url} alt={title}
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
      onClick={() => onOpen(item)}
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
          onClick={(e) => { e.stopPropagation(); onRemove(item); }}
          aria-label={`删除 ${title}`}
        >×</button>
      )}
    </div>
  );
}
