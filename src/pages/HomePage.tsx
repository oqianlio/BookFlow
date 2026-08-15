import { useEffect, useMemo, useState } from "react";
import { listBooks, listShelfSourceBooks, type Book, type ShelfSourceBook } from "../services/api";
import BookCard, { type ShelfItem } from "../components/BookCard";
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

function openedAt(item: ShelfItem): number | null {
  return item.kind === "local" ? item.book.last_opened_at : item.sb.last_opened_at;
}

export default function HomePage({ onGoBookshelf, onGoDiscover, onOpenBook, onOpenSourceBook }: {
  onGoBookshelf?: () => void; onGoDiscover?: () => void;
  onOpenBook?: (b: Book) => void; onOpenSourceBook?: (sb: ShelfSourceBook) => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [shelf, setShelf] = useState<ShelfSourceBook[]>([]);
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [local, source] = await Promise.all([
          listBooks(),
          listShelfSourceBooks().catch(() => [] as ShelfSourceBook[]),
        ]);
        if (!cancelled) {
          setBooks(local);
          setShelf(source);
        }
      } catch (e) {
        if (!cancelled) showError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [showError]);

  const stats = computeStats(books);
  const allItems = useMemo<ShelfItem[]>(
    () => [
      ...books.map((b) => ({ kind: "local" as const, book: b })),
      ...shelf.map((sb) => ({ kind: "source" as const, sb })),
    ],
    [books, shelf],
  );
  // 最近阅读：按最近打开时间取前 6（从未打开的排最后不展示）
  const recent = useMemo(
    () =>
      allItems
        .filter((i) => openedAt(i) != null)
        .sort((a, b) => (openedAt(b) as number) - (openedAt(a) as number))
        .slice(0, 6),
    [allItems],
  );

  const openItem = (item: ShelfItem) => {
    if (item.kind === "local") onOpenBook?.(item.book);
    else onOpenSourceBook?.(item.sb);
  };

  const empty = books.length === 0 && shelf.length === 0;

  return (
    <div className="home page">
      <header className="library-header">
        <div className="brand"><h1>你好，枕书</h1></div>
      </header>
      {empty ? (
        <div className="empty">
          <h2>书架空空如也</h2>
          <p>去书架页导入书籍，开始你的阅读之旅。</p>
          {onGoBookshelf && (
            <button className="btn btn-primary" onClick={onGoBookshelf}>去书架导入</button>
          )}
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <h2 className="home-section">最近阅读</h2>
              <div className="book-grid">
                {recent.map((item) => (
                  <BookCard
                    key={item.kind === "local" ? `local-${item.book.id}` : `source-${item.sb.id}`}
                    item={item}
                    onOpen={openItem}
                  />
                ))}
              </div>
            </>
          )}
          <h2 className="home-section">概览</h2>
          <div className="home-stats">
            <div className="stat-card"><span className="stat-value">{stats.total}</span><span className="stat-label">藏书</span></div>
            {stats.byFormat.map((f) => (
              <div className="stat-card" key={f.format}><span className="stat-value">{f.count}</span><span className="stat-label">{f.format.toUpperCase()}</span></div>
            ))}
            <div className="stat-card"><span className="stat-value">{stats.openedLast7}</span><span className="stat-label">近 7 天打开</span></div>
          </div>
        </>
      )}
      {!empty && (
        <>
          <h2 className="home-section">快捷操作</h2>
          <div className="home-quick">
            {onGoBookshelf && <button className="btn btn-soft" onClick={onGoBookshelf}>去书架</button>}
            {onGoDiscover && <button className="btn btn-soft" onClick={onGoDiscover}>去发现</button>}
          </div>
        </>
      )}
    </div>
  );
}
