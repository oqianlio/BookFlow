import { useEffect, useState } from "react";
import { listBookSources } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { type SearchHit } from "../services/searchService";

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

export interface ChannelCard { group: string; count: number; representative: string; icon: string; }

function emojiOf(name: string): string {
  const m = name.match(/\p{Extended_Pictographic}/u);
  if (m) return m[0];
  return name.trim().charAt(0) || "📚";
}

export function toChannelCards(groups: ExploreGroup[]): ChannelCard[] {
  return groups.map((g) => ({
    group: g.group, count: g.sources.length,
    representative: g.sources[0]?.name ?? "", icon: emojiOf(g.group),
  }));
}

export interface GroupedHit { title: string; author: string; sources: SearchHit[]; }

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

export default function DiscoverPage({ onOpenExplore }: {
  onOpenExplore?: (sourceId: number, sourceName: string) => void;
}) {
  const [sources, setSources] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = (await listBookSources()).filter((s) => s.enabled);
        const withExplore: Array<{ id: number; name: string }> = [];
        for (const s of all) {
          try {
            const src = parseBookSourceJson(s.json);
            if (src.exploreUrl) withExplore.push({ id: s.id, name: s.name });
          } catch { /* 跳过 */ }
        }
        if (!cancelled) setSources(withExplore);
      } catch {
        if (!cancelled) setSources([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="discover page">
      <header className="library-header"><h1>发现</h1></header>
      {sources.length > 0 && onOpenExplore ? (
        <section className="discover-channels">
          <div className="section-head">
            <h2 className="home-section">书源浏览</h2>
            <span className="section-sub">{sources.length} 个书源可浏览</span>
          </div>
          <div className="channel-grid">
            {sources.map((s) => (
              <button key={s.id} className="channel-card" onClick={() => onOpenExplore(s.id, s.name)}>
                <span className="channel-icon">{emojiOf(s.name)}</span>
                <div className="channel-body">
                  <span className="channel-name">{s.name}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <p className="panel-empty">暂无可浏览的书源</p>
      )}
    </div>
  );
}
