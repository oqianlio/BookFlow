import { useCallback, useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import ImportButton from "../components/ImportButton";
import SearchPanel, { type SearchHit } from "../components/SearchPanel";
import { importFiles, listBooks, removeBook, type Book } from "../services/api";

export default function LibraryPage({ onOpenBook }: { onOpenBook: (b: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await importFiles();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: number) => {
    if (!window.confirm("确定删除这本书吗？")) return;
    try {
      await removeBook(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSearchJump = (h: SearchHit) => {
    const book = books.find((b) => b.id === h.book_id);
    if (!book) return;
    const w = window as any;
    w.__searchJump = { text: h.location || h.text };
    onOpenBook(book);
    w.dispatchEvent(new CustomEvent("search-jump", { detail: { text: h.location || h.text } }));
  };

  return (
    <div className="library">
      <header className="library-header">
        <h1>阅卷</h1>
        <div className="library-actions">
          <button className="btn-secondary" onClick={() => setShowSearch((s) => !s)}>全文搜索</button>
          <ImportButton onImport={handleImport} busy={busy} />
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {showSearch && <SearchPanel onJump={handleSearchJump} />}
      {books.length === 0 ? (
        <p className="empty">书架空空如也，点击导入书籍</p>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <BookCard key={b.id} book={b} onOpen={onOpenBook} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
