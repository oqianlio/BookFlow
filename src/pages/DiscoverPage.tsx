import { useEffect, useState } from "react";
import { httpGet, listBookSources, mergeUserAgent, type BookSource } from "../services/api";
import { parseHtml, parseBookSourceJson, resolveSearchUrl, extractBookList, type BookSource as Src } from "../services/bookSourceEngine";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: BookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1);
  if (!parsed.url) return [];
  let cookieJarHost = "";
  try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
  const html = await httpGet(parsed.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, parsed.method, parsed.body, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  const items = extractBookList(doc, rules, { baseUrl: src.bookSourceUrl, result: html });
  return items.filter((i) => i.name).map((i) => ({
    title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
    bookUrl: i.bookUrl ?? "", sourceId: bs.id, sourceName: bs.name,
  }));
}

export default function DiscoverPage({ onBack, onOpenBook, onOpenExplore }: {
  onBack: () => void;
  onOpenBook: (h: SearchHit) => void;
  onOpenExplore?: (sourceId: number, sourceName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exploreSources, setExploreSources] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sources = (await listBookSources()).filter((s) => s.enabled);
        const withExplore: Array<{ id: number; name: string }> = [];
        for (const s of sources) {
          try {
            const src = parseBookSourceJson(s.json);
            if (src.exploreUrl) withExplore.push({ id: s.id, name: s.name });
          } catch {
            // 单个书源 JSON 解析失败，跳过该书源
          }
        }
        if (!cancelled) setExploreSources(withExplore);
      } catch {
        if (!cancelled) setExploreSources([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      {exploreSources.length > 0 && onOpenExplore && (
        <div className="explore-entry">
          {exploreSources.map((s) => (
            <button key={s.id} className="btn btn-ghost" onClick={() => onOpenExplore(s.id, s.name)}>浏览 {s.name}</button>
          ))}
        </div>
      )}
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
