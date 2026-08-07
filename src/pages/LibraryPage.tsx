import { useCallback, useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import SearchPanel, { type SearchHit } from "../components/SearchPanel";
import { importFiles, listBooks, removeBook, type Book } from "../services/api";

function EmptyShelfIcon() {
  return (
    <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 4h16v16H4z" strokeLinejoin="round" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
      <path d="M3 5v14M21 5v14" strokeLinecap="round" />
    </svg>
  );
}

export default function LibraryPage({
  onOpenBook,
  onOpenSettings,
}: {
  onOpenBook: (b: Book) => void;
  onOpenSettings?: () => void;
}) {
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
    // 打开书籍后按命中定位：EPUB 章节 href / PDF 页码 / MD/TXT 行号
    w.__searchJump = { location: h.location, format: h.format };
    onOpenBook(book);
    w.dispatchEvent(new CustomEvent("search-jump", { detail: { location: h.location, format: h.format } }));
  };

  return (
    <div className="library">
      <header className="library-header">
        <div className="brand">
          <h1>阅卷</h1>
          <small>桌面阅读器</small>
        </div>
        <div className="library-actions">
          <button className="btn btn-ghost" onClick={() => setShowSearch((s) => !s)}>全文搜索</button>
          {onOpenSettings && (
            <button className="btn btn-ghost" onClick={onOpenSettings}>设置</button>
          )}
          <button className="btn btn-primary" onClick={handleImport} disabled={busy}>
            {busy ? "导入中…" : "导入书籍"}
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {showSearch && <SearchPanel onJump={handleSearchJump} />}
      {books.length === 0 ? (
        <div className="empty">
          <EmptyShelfIcon />
          <h2>书架空空如也，点击导入书籍</h2>
          <p>支持 EPUB · PDF · Markdown · TXT 四种格式，导入后即可开始阅读</p>
        </div>
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
