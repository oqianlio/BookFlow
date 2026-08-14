import { useCallback, useEffect, useState } from "react";
import BookCard from "../components/BookCard";
import SearchPanel, { type SearchHit } from "../components/SearchPanel";
import { BookIcon, SearchIcon } from "../components/icons";
import { importFiles, listBooks, removeBook, type Book } from "../services/api";
import { useError } from "../components/ErrorDialog";

export default function LibraryPage({ onOpenBook }: {
  onOpenBook: (b: Book) => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { showError } = useError();

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
    } catch (e) {
      showError(String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleImport = async () => {
    setBusy(true);
    try {
      await importFiles();
      await refresh();
    } catch (e) {
      showError(String(e));
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
      showError(String(e));
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
          <h1>枕书</h1>
          <small>桌面阅读器</small>
        </div>
        <div className="library-actions">
          <button
            className={`btn-icon${showSearch ? " active" : ""}`}
            onClick={() => setShowSearch((s) => !s)}
            aria-label="全文搜索"
            title="全文搜索"
          >
            <SearchIcon size={17} />
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={busy}>
            {busy ? "导入中…" : "导入书籍"}
          </button>
        </div>
      </header>
      {showSearch && <SearchPanel onJump={handleSearchJump} />}
      {books.length === 0 ? (
        <div className="empty">
          <BookIcon size={56} />
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
