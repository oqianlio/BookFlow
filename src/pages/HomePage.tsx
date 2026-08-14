import { useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import { listBooks, type Book } from "../services/api";
import { useError } from "../components/ErrorDialog";

export interface HomeStats {
  total: number;
  byFormat: Array<{ format: string; count: number }>;
  openedLast7: number;
}

export function computeStats(books: Book[], now: number = Math.floor(Date.now() / 1000)): HomeStats {
  const counts = new Map<string, number>();
  let openedLast7 = 0;
  for (const b of books) {
    counts.set(b.format, (counts.get(b.format) ?? 0) + 1);
    if (b.last_opened_at != null && now - b.last_opened_at <= 7 * 86400) openedLast7 += 1;
  }
  const byFormat = [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count);
  return { total: books.length, byFormat, openedLast7 };
}

export default function HomePage({ onOpenBook, onGoBookshelf }: {
  onOpenBook: (b: Book) => void; onGoBookshelf?: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBooks();
        if (!cancelled) setBooks(list);
      } catch (e) {
        if (!cancelled) showError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = computeStats(books);
  const recent = [...books]
    .sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0))
    .slice(0, 6);

  return (
    <div className="home page">
      <header className="library-header">
        <div className="brand"><h1>你好，枕书</h1></div>
        {onGoBookshelf && <button className="btn btn-soft" onClick={onGoBookshelf}>管理书架</button>}
      </header>
      {books.length === 0 ? (
        <div className="empty">
          <h2>书架空空如也</h2>
          <p>去书架页导入书籍，开始你的阅读之旅。</p>
        </div>
      ) : (
        <>
          <div className="home-stats">
            <div className="stat-card"><span className="stat-value">{stats.total}</span><span className="stat-label">藏书</span></div>
            {stats.byFormat.map((f) => (
              <div className="stat-card" key={f.format}><span className="stat-value">{f.count}</span><span className="stat-label">{f.format.toUpperCase()}</span></div>
            ))}
            <div className="stat-card"><span className="stat-value">{stats.openedLast7}</span><span className="stat-label">近 7 天打开</span></div>
          </div>
          <h2 className="home-section">最近阅读</h2>
          <div className="book-grid">
            {recent.map((b) => <BookCard key={b.id} book={b} onOpen={onOpenBook} />)}
          </div>
        </>
      )}
    </div>
  );
}
