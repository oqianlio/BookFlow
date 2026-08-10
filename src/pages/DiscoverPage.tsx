import { useState } from "react";
import { httpGet, listBookSources, mergeUserAgent, type BookSource } from "../services/api";
import { parseHtml, extractList, parseBookSourceJson, resolveSearchUrl, type BookSource as Src } from "../services/bookSourceEngine";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: BookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1);
  if (!parsed.url) return [];
  const html = await httpGet(parsed.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, parsed.method, parsed.body);
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  const itemRules: Record<string, string> = {};
  for (const k of ["name", "author", "coverUrl", "bookUrl"] as const) {
    if (rules[k]) itemRules[k] = rules[k];
  }
  const items = extractList(doc, rules.bookList ?? "", itemRules, { baseUrl: src.bookSourceUrl, result: html });
  return items.filter((i) => i.name).map((i) => ({
    title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
    bookUrl: i.bookUrl ?? "", sourceId: bs.id, sourceName: bs.name,
  }));
}

export default function DiscoverPage({ onBack, onOpenBook }: {
  onBack: () => void;
  onOpenBook: (h: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true); setError(null);
    try {
      const sources = (await listBookSources()).filter((s) => s.enabled);
      const all = await Promise.all(sources.map((s) => searchSource(query.trim(), s).catch(() => [] as SearchHit[])));
      setHits(all.flat());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="discover page">
      <header className="library-header">
        <div className="brand"><h1>发现</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回书架</button>
      </header>
      <div className="discover-search">
        <input aria-label="搜索关键词" placeholder="输入书名搜索所有已启用书源" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="discover-results">
        {hits.length === 0 && !busy ? (
          <p className="panel-empty">输入关键词开始搜索</p>
        ) : (
          hits.map((h, i) => (
            <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onOpenBook(h)}>
              <div className="hit-info">
                <span className="hit-title">{h.title}</span>
                <span className="hit-author">{h.author}</span>
              </div>
              <span className="hit-source">{h.sourceName}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
