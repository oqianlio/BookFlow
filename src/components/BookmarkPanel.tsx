import { useCallback, useEffect, useState } from "react";
import { addBookmark, deleteBookmark, listBookmarks } from "../services/api";

export interface BookmarkItem {
  id: number; book_id: number; location: string; label: string; created_at: number;
}

export default function BookmarkPanel({ bookId, onJump, onChanged }: {
  bookId: number; onJump: (loc: string) => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const refresh = useCallback(async () => {
    setItems((await listBookmarks(bookId)) as BookmarkItem[]);
  }, [bookId]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener("bookmark-changed", onChanged);
    return () => window.removeEventListener("bookmark-changed", onChanged);
  }, [refresh]);

  const handleAdd = async () => {
    const w = window as any;
    const loc = w.__readerLocation ?? "";
    if (!loc) return;
    await addBookmark({ bookId, location: loc, label: `书签 ${items.length + 1}` });
    await refresh();
    onChanged();
    window.dispatchEvent(new CustomEvent("annotation-changed"));
  };

  const handleDelete = async (id: number) => {
    await deleteBookmark(id);
    await refresh();
    onChanged();
    window.dispatchEvent(new CustomEvent("annotation-changed"));
  };

  return (
    <aside className="panel">
      <h3>书签</h3>
      <button className="btn-primary" onClick={handleAdd}>添加当前书签</button>
      {items.length === 0 ? <p className="panel-empty">暂无书签</p> : (
        <ul>
          {items.map((b) => (
            <li key={b.id}>
              <p onClick={() => onJump(b.location)}>{b.label}</p>
              <button onClick={() => handleDelete(b.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
