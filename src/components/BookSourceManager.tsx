import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { deleteBookSource, listBookSources, setBookSourceEnabled, type BookSource } from "../services/api";
import { commitBookSource, importBookSourceFromFile, importBookSourceFromUrl, sourceUsesJs } from "../services/bookSourceImport";
import { useError } from "./ErrorDialog";

export default function BookSourceManager({ onDebug }: { onDebug?: (sourceId: number, sourceName: string) => void }) {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { showError } = useError();
  const [pendingSources, setPendingSources] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { showError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const confirmJsImport = (bookSource: any): boolean => {
    if (!sourceUsesJs(bookSource)) return true;
    return window.confirm("此书源包含可在本机执行的 JS 脚本，仅导入你信任的书源。继续？");
  };

  const handleImportResult = async (bookSources: any[]) => {
    if (bookSources.length === 1) {
      const bs = bookSources[0];
      if (!confirmJsImport(bs)) return;
    let existing: Set<string>;
    try {
      existing = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(String(e));
      return;
    }
    if (existing.has(bs.bookSourceUrl)) {
      setImportMsg(`书源已存在，跳过：${bs.bookSourceName}`);
      await refresh();
      return;
    }
    await commitBookSource(bs);
    await refresh();
    return;
  }
    let existingUrls: Set<string>;
    try {
      existingUrls = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(String(e));
      return;
    }
    setPendingSources(bookSources);
    setExistingUrls(existingUrls);
    // 默认勾选本地不存在的新书源；已存在的显示但不勾选
    setSelected(new Set(bookSources.map((_, i) => i).filter((i) => !existingUrls.has(bookSources[i].bookSourceUrl))));
    setImportMsg(null);
  };

  const confirmImportSelection = async () => {
    if (!pendingSources) return;
    let existing: Set<string>;
    try {
      existing = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(`读取现有书源失败：${String(e)}`);
      return;
    }
    const dedup = new Set(existing);
    let added = 0, skipped = 0;
    for (const i of selected) {
      const bs = pendingSources[i];
      if (dedup.has(bs.bookSourceUrl)) { skipped++; continue; }
      dedup.add(bs.bookSourceUrl);
      try {
        await commitBookSource(bs);
        added++;
      } catch {
        skipped++;
      }
    }
    setImportMsg(`成功导入 ${added} 个，跳过 ${skipped} 个`);
    setPendingSources(null);
    await refresh();
  };

  const toggleSelect = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  };

  const handleFileImport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const result = await importBookSourceFromFile(path);
      await handleImportResult(result.bookSources);
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const result = await importBookSourceFromUrl(url.trim());
      await handleImportResult(result.bookSources);
      setUrl("");
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBookSource(id);
      await refresh();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleToggleEnable = async (id: number, enabled: boolean) => {
    try {
      await setBookSourceEnabled(id, enabled);
      await refresh();
    } catch (e) {
      showError(String(e));
    }
  };

  return (
    <div className="book-source-manager">
      <h3>书源</h3>
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
                <button className="btn btn-ghost" onClick={() => onDebug?.(s.id, s.name)}>调试</button>
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
      {pendingSources && (
        <div className="import-confirm">
          <h4>确认导入书源</h4>
          <ul className="import-confirm-list">
            {pendingSources.map((bs, i) => (
              <li key={i}>
                <input
                  type="checkbox"
                  aria-label={bs.bookSourceName}
                  checked={selected.has(i)}
                  onChange={() => toggleSelect(i)}
                />
                <span className="import-confirm-name">{bs.bookSourceName}</span>
                <span className="import-confirm-url">{bs.bookSourceUrl}</span>
                {existingUrls.has(bs.bookSourceUrl) && <span className="import-confirm-existing">已有</span>}
                {sourceUsesJs(bs) && <span className="import-confirm-js">含脚本</span>}
              </li>
            ))}
          </ul>
          <div className="import-confirm-actions">
            <button className="btn btn-primary" onClick={() => void confirmImportSelection()} disabled={selected.size === 0}>
              导入选中 {selected.size} 个
            </button>
            <button className="btn btn-ghost" onClick={() => setPendingSources(null)}>取消</button>
          </div>
        </div>
      )}
      {importMsg && <p className="error import-msg">{importMsg}</p>}
    </div>
  );
}
