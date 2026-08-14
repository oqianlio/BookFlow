import { useEffect, useState } from "react";
import { listBooks, importFiles, type Book } from "../services/api";
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

export default function HomePage({ onGoBookshelf, onGoDiscover }: {
  onGoBookshelf?: () => void; onGoDiscover?: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
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

  const handleImport = async () => {
    setBusy(true);
    try {
      await importFiles();
      setBooks(await listBooks());
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home page">
      <header className="library-header">
        <div className="brand"><h1>你好，枕书</h1></div>
      </header>
      {books.length === 0 ? (
        <div className="empty">
          <h2>书架空空如也</h2>
          <p>去书架页导入书籍，开始你的阅读之旅。</p>
        </div>
      ) : (
        <>
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
      <h2 className="home-section">快捷操作</h2>
      <div className="home-quick">
        <button className="btn btn-primary" onClick={() => void handleImport()} disabled={busy}>
          {busy ? "导入中…" : "导入书籍"}
        </button>
        <button className="btn btn-soft" onClick={onGoBookshelf}>去书架</button>
        <button className="btn btn-soft" onClick={onGoDiscover}>去发现</button>
      </div>
    </div>
  );
}
