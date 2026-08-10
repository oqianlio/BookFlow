import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { deleteBookSource, listBookSources, setBookSourceEnabled, type BookSource } from "../services/api";
import { commitBookSource, importBookSourceFromFile, importBookSourceFromUrl } from "../services/bookSourceImport";

export default function BookSourceManager() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleFileImport = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const result = await importBookSourceFromFile(path);
      await commitBookSource(result.bookSource);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importBookSourceFromUrl(url.trim());
      await commitBookSource(result.bookSource);
      setUrl("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
        <p className="panel-empty">暂无书源</p>
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
                  onChange={(e) => void handleToggleEnable(s.id, e.target.checked)}
                />
                <button className="btn btn-ghost" onClick={() => void handleDelete(s.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="source-import">
        <button className="btn btn-ghost" onClick={() => void handleFileImport()}>从文件导入</button>
        <div className="source-import-row">
          <input
            aria-label="书源网址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleUrlImport()}
            placeholder="粘贴书源 JSON 网址"
          />
          <button className="btn btn-primary" onClick={() => void handleUrlImport()} disabled={busy || !url.trim()}>
            {busy ? "导入中…" : "从网址导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
