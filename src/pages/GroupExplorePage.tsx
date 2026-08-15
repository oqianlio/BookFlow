import type { ExploreSource } from "./DiscoverPage";

export default function GroupExplorePage({ groupName, sources, onBack, onOpenExplore }: {
  groupName: string;
  sources: ExploreSource[];
  onBack: () => void;
  onOpenExplore: (sourceId: number, sourceName: string) => void;
}) {
  return (
    <div className="discover explore page">
      <header className="library-header">
        <div className="brand"><h1>{groupName} · 书源</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      {sources.length === 0 ? (
        <p className="panel-empty">该分组暂无书源</p>
      ) : (
        <div className="discover-results">
          {sources.map((s) => (
            <div className="hit-card" key={s.id} onClick={() => onOpenExplore(s.id, s.name)}>
              <div className="hit-info">
                <span className="hit-title">{s.name}</span>
              </div>
              <span className="hit-source">浏览</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
