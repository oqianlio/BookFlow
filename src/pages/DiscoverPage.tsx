import { useEffect, useState } from "react";
import { listBookSources } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { type SearchHit } from "../services/searchService";

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

export default function DiscoverPage({ onOpenExplore, onOpenGroupExplore }: {
  onOpenExplore?: (sourceId: number, sourceName: string) => void;
  onOpenGroupExplore?: (groupName: string, sources: ExploreSource[]) => void;
}) {
  const [exploreSources, setExploreSources] = useState<Array<{ id: number; name: string; json: string }>>([]);


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

  return (
    <div className="discover page">
      <header className="library-header"><h1>发现</h1></header>
      {groups.length > 0 && onOpenExplore ? (
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
      ) : (
        <p className="panel-empty">暂无可浏览的书源</p>
      )}
    </div>
  );
}
