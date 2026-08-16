import { useEffect, useState } from "react";
import { listBookSources } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { searchBookSources, type SearchHit } from "../services/searchService";
import { useError } from "../components/ErrorDialog";
import { saveDiscoverSnapshot, takeDiscoverSnapshot } from "./navCache";

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

export interface ChannelCard {
  group: string;
  count: number;
  representative: string;
  icon: string;
}

function emojiOf(name: string): string {
  const m = name.match(/\p{Extended_Pictographic}/u);
  if (m) return m[0];
  return name.trim().charAt(0) || "📚";
}

export function toChannelCards(groups: ExploreGroup[]): ChannelCard[] {
  return groups.map((g) => ({
    group: g.group,
    count: g.sources.length,
    representative: g.sources[0]?.name ?? "",
    icon: emojiOf(g.group),
  }));
}

export interface GroupedHit {
  title: string;
  author: string;
  sources: SearchHit[];
}

export function groupSearchHits(hits: SearchHit[]): GroupedHit[] {
  const map = new Map<string, GroupedHit>();
  for (const h of hits) {
    const key = `${h.title.trim()}|${(h.author ?? "").trim()}`;
    const existing = map.get(key);
    if (existing) existing.sources.push(h);
    else map.set(key, { title: h.title, author: h.author, sources: [h] });
  }
  return [...map.values()];
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

  useEffect(() => {
    // 从详情页返回时恢复上次的搜索词与结果，避免重新搜索
    const snap = takeDiscoverSnapshot();
    if (snap) {
      setQuery(snap.query);
      setHits(snap.hits);
    }
  }, []);

  const groups = groupExploreSources(exploreSources);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const h = await searchBookSources(query);
      setHits(h);
      saveDiscoverSnapshot({ query, hits: h });
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const grouped = groupSearchHits(hits);

  return (
    <div className="discover page">
      <header className="library-header"><h1>发现</h1></header>
      <div className="discover-search">
        <input aria-label="搜索关键词" placeholder="输入书名，跨书源搜索" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>
      {groups.length > 0 && onOpenExplore && (
        <section className="discover-channels">
          <div className="section-head">
            <h2 className="home-section">书源频道</h2>
            <span className="section-sub">{exploreSources.length} 个书源可浏览</span>
          </div>
          <div className="channel-grid">
            {toChannelCards(groups).map((c) => (
              <button key={c.group} className="channel-card" onClick={() => {
                const g = groups.find((x) => x.group === c.group);
                if (g) onOpenGroupExplore?.(g.group, g.sources);
              }}>
                <span className="channel-icon">{c.icon}</span>
                <div className="channel-body">
                  <span className="channel-name">{c.group}</span>
                  <span className="channel-sub">{c.count} 个书源{c.representative ? ` · ${c.representative}` : ""}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="discover-results">
        {busy ? (
          <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>搜索中…</span></span></p>
        ) : query.trim() && grouped.length === 0 ? (
          <p className="panel-empty">未找到相关书籍，试试其他关键词</p>
        ) : !query.trim() && grouped.length === 0 ? (
          <p className="panel-empty">输入书名，跨书源搜索</p>
        ) : (
          grouped.map((g, i) => (
            <div className="hit-card result-card" key={i}>
              <div className="hit-info" onClick={() => onOpenBook(g.sources[0])}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenBook(g.sources[0]); } }}>
                <span className="hit-title">{g.title}</span>
                <span className="hit-author">
                  {g.author || (g.sources.length > 1 ? `来自 ${g.sources.length} 个书源` : g.sources[0]?.sourceName)}
                </span>
              </div>
              <div className="result-sources">
                {g.sources.map((s) => (
                  <button key={`${s.sourceId}-${s.bookUrl}`} className="result-source" onClick={() => onOpenBook(s)}>{s.sourceName}</button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
