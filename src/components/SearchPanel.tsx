import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SearchHit {
  book_id: number; title: string; format: string; text: string; location: string;
}

export default function SearchPanel({ onJump }: { onJump: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);

  const run = async () => {
    if (!query.trim()) return;
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const r = await invoke<SearchHit[]>("search_books", { query });
      if (seq !== seqRef.current) return; // 丢弃过期搜索响应
      setResults(r);
    } catch {
      if (seq !== seqRef.current) return;
      setResults([]);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  return (
    <aside className="panel search-panel">
      <h3>全文搜索</h3>
      <div className="panel-add">
        <input aria-label="搜索关键词" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()} placeholder="搜索书名与正文" />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      {query.trim() && !busy && results.length === 0 ? (
        <p className="panel-empty">无搜索结果</p>
      ) : (
        <>
          {results.length > 0 && <p className="panel-empty search-count">共 {results.length} 条</p>}
          <ul>
            {results.map((h, i) => (
              <li key={`${h.book_id}-${i}`}>
                {/* location 由 Rust 侧按格式填充（EPUB 章节 href / PDF 页码 / 文本行号） */}
                <p className="hit-title" onClick={() => onJump(h)}>{h.title}</p>
                <p className="hit-text">{h.text}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
