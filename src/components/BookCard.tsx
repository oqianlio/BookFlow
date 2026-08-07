import type { Book } from "../services/api";
import { coverUrl } from "../services/api";

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

export default function BookCard({ book, onOpen, onRemove }: {
  book: Book; onOpen: (b: Book) => void; onRemove: (id: number) => void;
}) {
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(book);
    }
  };

  return (
    <div
      className="book-card"
      onClick={() => onOpen(book)}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      aria-label={`打开 ${book.title}`}
    >
      {book.cover_path ? (
        <img className="book-cover" src={coverUrl(book.cover_path)} alt={book.title} />
      ) : (
        <div className={`book-cover book-cover-placeholder ${placeholderClass(book.format)}`}>
          <span>{formatLabel(book.format)}</span>
          <span className="ph-rule" />
        </div>
      )}
      <div className="book-meta">
        <h3>{book.title}</h3>
        <div className="book-sub">
          <span className="fmt">{formatLabel(book.format)}</span>
        </div>
      </div>
      <button
        className="book-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(book.id); }}
        aria-label={`删除 ${book.title}`}
      >×</button>
    </div>
  );
}
