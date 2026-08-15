import { useEffect, useMemo, useRef, useState } from "react";
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

  // 同一书源只保留一个候选：按书名匹配度评分（3=完全一致 > 2=互相包含 > 1=其他），每个源取最高分，同分保留先出现
  const candidates = useMemo(() => {
    const a = title.trim();
    const score = (h: SearchHit) => {
      const b = h.title.trim();
      if (b === a) return 3;
      if (b.includes(a) || a.includes(b)) return 2;
      return 1;
    };
    const best = new Map<number, SearchHit>();
    for (const h of hits) {
      const cur = best.get(h.sourceId);
      if (!cur || score(h) > score(cur)) best.set(h.sourceId, h);
    }
    return [...best.values()];
  }, [hits, title]);

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
      {candidates.length > 0 && (
        <div className="switch-source-list">
          {candidates.map((h, i) => (
            <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onPick(h)}>
              <div className="hit-info">
                {/* 书名统一显示用户确认的书名，避免各源解析出杂质书名（如「三体_笔趣阁」） */}
                <span className="hit-title">{title}</span>
                <span className="hit-author">{h.author || author}</span>
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
