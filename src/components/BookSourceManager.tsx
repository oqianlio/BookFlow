import { useCallback, useEffect, useState } from "react";
import { addBookSource, deleteBookSource, listBookSources, setBookSourceEnabled, type BookSource } from "../services/api";

export default function BookSourceManager() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!raw.trim()) return;
    setError(null);
    try {
      const obj = JSON.parse(raw);
      if (typeof obj !== "object" || obj === null) {
        setError("书源 JSON 格式不正确");
        return;
      }
      if (!obj.bookSourceName || !obj.bookSourceUrl) {
        setError("书源 JSON 缺少 bookSourceName 或 bookSourceUrl");
        return;
      }
      await addBookSource(obj.bookSourceName, obj.bookSourceUrl, JSON.stringify(obj));
      setRaw("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await deleteBookSource(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleEnable = async (id: number, enabled: boolean) => {
    setError(null);
    try {
      await setBookSourceEnabled(id, enabled);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="book-source-manager">
      <h3>书源</h3>
      {error && <p className="error">{error}</p>}
      {sources.length === 0 ? (
        <p className="panel-empty">暂无书源，粘贴 legado 书源 JSON 添加</p>
      ) : (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <div className="source-info">
                <span className="source-name">{s.name}</span>
                <span className="source-url">{s.url}</span>
              </div>
              <div className="source-actions">
                <input
                  type="checkbox"
                  aria-label={`启用 ${s.name}`}
                  checked={s.enabled}
                  onChange={(e) => handleToggleEnable(s.id, e.target.checked)}
                />
                <button className="btn btn-ghost" onClick={() => handleDelete(s.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-add">
        <textarea
          aria-label="书源 JSON"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='粘贴书源 JSON，如 {"bookSourceUrl":"...","bookSourceName":"...",...}'
          rows={4}
        />
        <button className="btn btn-primary" onClick={handleAdd} disabled={!raw.trim()}>添加书源</button>
      </div>
    </div>
  );
}
