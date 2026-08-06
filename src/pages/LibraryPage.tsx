import { useCallback, useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import ImportButton from "../components/ImportButton";
import { importFiles, listBooks, removeBook, type Book } from "../services/api";

export default function LibraryPage({ onOpenBook }: { onOpenBook: (b: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="library">
      <header className="library-header">
        <h1>阅卷</h1>
        <ImportButton onImport={handleImport} busy={busy} />
      </header>
      {error && <p className="error">{error}</p>}
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
