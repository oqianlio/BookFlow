import type { Book } from "../services/api";
import { coverUrl } from "../services/api";

export function formatLabel(format: string) {
  return format.toUpperCase();
}

export default function BookCard({ book, onOpen, onRemove }: {
  book: Book; onOpen: (b: Book) => void; onRemove: (id: number) => void;
}) {
  return (
    <div className="book-card" onClick={() => onOpen(book)} role="button" tabIndex={0}>
      {book.cover_path ? (
        <img className="book-cover" src={coverUrl(book.cover_path)} alt={book.title} />
      ) : (
        <div className="book-cover book-cover-placeholder">
          <span>{formatLabel(book.format)}</span>
        </div>
      )}
      <div className="book-meta">
        <h3>{book.title}</h3>
        <span>{formatLabel(book.format)}</span>
      </div>
      <button
        className="book-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(book.id); }}
        aria-label={`删除 ${book.title}`}
      >×</button>
    </div>
  );
}
