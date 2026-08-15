import { useEffect, useState } from "react";
import { listBookSources } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { searchBookSources, type SearchHit } from "../services/searchService";
import { useError } from "../components/ErrorDialog";

export type { SearchHit } from "../services/searchService";

export interface ExploreSource { id: number; name: string }
export interface ExploreGroup { group: string; sources: ExploreSource[] }

export function groupExploreSources(sources: Array<{ id: number; name: string; json: string }>): ExploreGroup[] {
  const map = new Map<string, ExploreSource[]>();
  const add = (g: string, s: ExploreSource) => {
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  };
  for (const s of sources) {
    let groups: string[] = [];
    try {
      const parsed = JSON.parse(s.json);
      groups = String(parsed?.bookSourceGroup ?? "").split(",").map((g) => g.trim()).filter(Boolean);
    } catch { /* 归未分组 */ }
    if (groups.length === 0) add("未分组", { id: s.id, name: s.name });
    else for (const g of groups) add(g, { id: s.id, name: s.name });
  }
  return [...map.entries()]
    .map(([group, items]) => ({ group, sources: items }))
    .sort((a, b) => b.sources.length - a.sources.length);
}

export default function DiscoverPage({ onOpenBook, onOpenExplore, onOpenGroupExplore }: {
  onOpenBook: (h: SearchHit) => void;
  onOpenExplore?: (sourceId: number, sourceName: string) => void;
  onOpenGroupExplore?: (groupName: string, sources: ExploreSource[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [exploreSources, setExploreSources] = useState<Array<{ id: number; name: string; json: string }>>([]);
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sources = (await listBookSources()).filter((s) => s.enabled);
        const withExplore: Array<{ id: number; name: string; json: string }> = [];
        for (const s of sources) {
          try {
            const src = parseBookSourceJson(s.json);
            if (src.exploreUrl) withExplore.push({ id: s.id, name: s.name, json: s.json });
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

  const groups = groupExploreSources(exploreSources);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setHits(await searchBookSources(query));
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="discover page">
      <header className="library-header"><h1>发现</h1></header>
      <div className="discover-search">
        <input aria-label="搜索关键词" placeholder="输入书名搜索所有已启用书源" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      {groups.length > 0 && onOpenExplore && (
        <div className="explore-groups">
          <h2 className="home-section">书源频道</h2>
          <div className="explore-channels">
            {groups.map((g) => (
              <button key={g.group} className="group-channel" onClick={() => onOpenGroupExplore?.(g.group, g.sources)}>
                <span className="group-name">{g.group}</span>
                <span className="count">{g.sources.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
