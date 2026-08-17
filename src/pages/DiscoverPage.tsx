import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listBookSources } from "../services/api";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import { searchBookSources, type SearchHit } from "../services/searchService";
import { useError } from "../components/ErrorDialog";
import { saveDiscoverSnapshot, takeDiscoverSnapshot } from "./navCache";

export type { SearchHit } from "../services/searchService";

/** 本地书搜索结果（SearchPanel 的 SearchHit） */
export interface LocalSearchHit {
  book_id: number; title: string; format: string; text: string; location: string;
}

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

export default function DiscoverPage({ onOpenBook, onOpenExplore, onOpenGroupExplore, onJumpLocal }: {
  onOpenBook: (h: SearchHit) => void;
  onOpenExplore?: (sourceId: number, sourceName: string) => void;
  onOpenGroupExplore?: (groupName: string, sources: ExploreSource[]) => void;
  onJumpLocal?: (hit: LocalSearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlineHits, setOnlineHits] = useState<SearchHit[]>([]);
  const [localHits, setLocalHits] = useState<LocalSearchHit[]>([]);
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
    const snap = takeDiscoverSnapshot();
    if (snap) {
      setQuery(snap.query);
      setOnlineHits(snap.hits);
    }
  }, []);

  const groups = groupExploreSources(exploreSources);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      // 并行搜索：本地已导入 + 在线书源
      const [local, online] = await Promise.allSettled([
        invoke<LocalSearchHit[]>("search_books", { query }),
        searchBookSources(query),
      ]);
      const lHits = local.status === "fulfilled" ? local.value : [];
      const oHits = online.status === "fulfilled" ? online.value : [];
      setLocalHits(lHits);
      setOnlineHits(oHits);
      saveDiscoverSnapshot({ query, hits: oHits });
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const grouped = groupSearchHits(onlineHits);
  const hasResults = query.trim() && (grouped.length > 0 || localHits.length > 0);

  return (
    <div className="discover page">
      <header className="library-header"><h1>发现</h1></header>
      <div className="discover-search">
        <input aria-label="搜索关键词" placeholder="输入书名，搜索本地书和在线书源" value={query}
          style={{ flex: 1 }}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !query.trim()}>搜索</button>
      </div>

      {busy ? (
        <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>搜索中…</span></span></p>
      ) : query.trim() && !hasResults ? (
        <p className="panel-empty">未找到相关书籍，试试其他关键词</p>
      ) : !query.trim() ? (
        <>
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
          <p className="panel-empty" style={{ marginTop: 24 }}>输入书名，搜索本地书和在线书源</p>
        </>
      ) : (
        <>
          {/* 本地已导入 */}
          {localHits.length > 0 && (
            <section className="discover-section">
              <div className="section-head">
                <h2 className="home-section">本地已导入</h2>
                <span className="section-sub">{localHits.length} 本</span>
              </div>
              {localHits.map((h) => (
                <div className="hit-card" key={`local-${h.book_id}`} onClick={() => onJumpLocal?.(h)}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJumpLocal?.(h); } }}>
                  <div className="hit-info">
                    <span className="hit-title">{h.title}</span>
                    <span className="hit-author">{h.format.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* 在线书源 */}
          {grouped.length > 0 && (
            <section className="discover-section">
              <div className="section-head">
                <h2 className="home-section">在线书源</h2>
                <span className="section-sub">{onlineHits.length} 条结果</span>
              </div>
              {grouped.map((g, i) => (
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
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
