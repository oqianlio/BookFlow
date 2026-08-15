import { useEffect, useRef, useState } from "react";
import { listBookSources } from "../services/api";
import { searchBookSources, type SearchHit } from "../services/searchService";

export default function SwitchSourcePanel({ title, author, excludeSourceId, onPick, onClose }: {
  title: string; author: string; excludeSourceId: number;
  onPick: (hit: SearchHit) => void; onClose: () => void;
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);

  const run = async () => {
    setBusy(true); setFailed(false);
    const seq = ++seqRef.current;
    try {
      const all = await listBookSources();
      const targets = all
        .filter((s) => s.enabled && s.id !== excludeSourceId)
        .map((s) => s.id);
      const h = await searchBookSources(`${title} ${author}`.trim(), { sourceIds: targets });
      if (seq !== seqRef.current) return;
      setHits(h);
    } catch {
      if (seq !== seqRef.current) return;
      setFailed(true);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  useEffect(() => { void run(); }, [excludeSourceId, title, author]);

  return (
    <div className="panel switch-source-panel">
      <h3>换源：{title}</h3>
      {busy && hits.length === 0 && <p className="panel-empty">搜索中…</p>}
      {failed && (
        <div className="panel-empty">
          <p>搜索失败</p>
          <button className="btn btn-primary" onClick={() => void run()}>重试</button>
        </div>
      )}
      {!busy && !failed && hits.length === 0 && <p className="panel-empty">未在其它书源找到该书</p>}
      {hits.length > 0 && (
        <div className="switch-source-list">
          {hits.map((h, i) => (
            <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onPick(h)}>
              <div className="hit-info">
                <span className="hit-title">{h.title}</span>
                <span className="hit-author">{h.author}</span>
              </div>
              <span className="hit-source">{h.sourceName}</span>
            </div>
          ))}
        </div>
      )}
      <div className="panel-actions">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
