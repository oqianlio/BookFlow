import { useCallback, useEffect, useState } from "react";
import BookCard, { type ShelfItem } from "../components/BookCard";
import SearchPanel, { type SearchHit } from "../components/SearchPanel";
import { BookIcon, SearchIcon } from "../components/icons";
import { importFiles, listBooks, removeBook, listShelfSourceBooks, removeShelfSourceBook, type Book, type ShelfSourceBook } from "../services/api";
import { useError } from "../components/ErrorDialog";

export default function LibraryPage({ onOpenBook, onOpenSourceBook }: {
  onOpenBook: (b: Book, jumpTo?: string) => void;
  onOpenSourceBook?: (sb: ShelfSourceBook) => void;
}) {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const { showError } = useError();

  const refresh = useCallback(async () => {
    try {
      const [local, source] = await Promise.all([
        listBooks(),
        listShelfSourceBooks().catch(() => [] as ShelfSourceBook[]),
      ]);
      setItems([
        ...local.map((b) => ({ kind: "local" as const, book: b })),
        ...source.map((sb) => ({ kind: "source" as const, sb })),
      ]);
    } catch (e) {
      showError(String(e));
    } finally {
      setInitialLoading(false);
    }
  }, [showError]);

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

  const handleRemove = async (item: ShelfItem) => {
    const name = item.kind === "local" ? item.book.title : item.sb.title;
    if (!window.confirm(`确定从书架移除「${name}」吗？`)) return;
    try {
      if (item.kind === "local") {
        await removeBook(item.book.id);
      } else {
        await removeShelfSourceBook(item.sb.id);
      }
      await refresh();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleOpen = (item: ShelfItem) => {
    if (item.kind === "local") onOpenBook(item.book);
    else onOpenSourceBook?.(item.sb);
  };

  const handleSearchJump = (h: SearchHit) => {
    const book = items.find((i) => i.kind === "local" && i.book.id === h.book_id) as { kind: "local"; book: Book } | undefined;
    if (!book) return;
    // 定位随打开书籍的状态一并传入阅读器（EPUB 章节 href / PDF 页码 / MD/TXT 行号）
    onOpenBook(book.book, h.location);
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
      {initialLoading ? (
        <div className="empty">
          <span className="loading-state"><span className="spinner" /><span>加载中…</span></span>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <BookIcon size={56} />
          <h2>书架空空如也，点击导入书籍</h2>
          <p>支持 EPUB · PDF · Markdown · TXT 四种格式；也可在「发现」中把在线书加入书架</p>
        </div>
      ) : (
        <div className="book-grid">
          {items.map((item) => (
            <BookCard
              key={item.kind === "local" ? `local-${item.book.id}` : `source-${item.sb.id}`}
              item={item}
              onOpen={handleOpen}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
