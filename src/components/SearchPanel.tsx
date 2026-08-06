import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SearchHit {
  book_id: number; title: string; format: string; text: string; location: string;
}

function snippetAround(text: string, query: string, radius = 40): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return text.slice(start, end).replace(/\s+/g, " ");
}

export default function SearchPanel({ onJump }: { onJump: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await invoke<SearchHit[]>("search_books", { query }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel search-panel">
      <h3>全文搜索</h3>
      <div className="panel-add">
        <input aria-label="搜索关键词" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()} placeholder="搜索书名与正文" />
        <button className="btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      <ul>
        {results.map((h, i) => (
          <li key={i}>
            <p className="hit-title" onClick={() => onJump({ ...h, location: snippetAround(h.text, query) })}>{h.title}</p>
            <p className="hit-text">{h.text.slice(0, 120)}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
