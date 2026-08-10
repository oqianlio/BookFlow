import { useCallback, useEffect, useRef, useState } from "react";
import { httpGet, listBookSources, mergeUserAgent } from "../services/api";
import { parseBookSourceJson, parseExploreUrl, extractBookList, parseHtml, resolveUrl, type BookSource as Src } from "../services/bookSourceEngine";
import type { SearchHit } from "./DiscoverPage";

export default function ExplorePage({ sourceId, sourceName, onBack, onOpenBook }: {
  sourceId: number; sourceName: string; onBack: () => void; onOpenBook: (h: SearchHit) => void;
}) {
  const [categories, setCategories] = useState<Array<{ title: string; url: string }>>([]);
  const [books, setBooks] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ title: string; url: string } | null>(null);
  const [page, setPage] = useState(1);
  const [src, setSrc] = useState<Src | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bs = (await listBookSources()).find((s) => s.id === sourceId);
        if (!bs) { setError("书源不存在"); return; }
        const s = parseBookSourceJson(bs.json);
        if (cancelled) return;
        setSrc(s);
        setCategories(parseExploreUrl(s.exploreUrl ?? ""));
      } catch (e) { if (!cancelled) setError(String(e)); }
    })();
    return () => { cancelled = true; };
  }, [sourceId]);

  const loadCategory = useCallback(async (cat: { title: string; url: string }, pg: number) => {
    if (!src) return;
    const seq = ++reqIdRef.current;
    setBusy(true); setError(null);
    try {
      const rawUrl = cat.url.replace("{{page}}", String(pg));
      const url = resolveUrl(rawUrl, src.bookSourceUrl);
      const html = await httpGet(url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined);
      const doc = parseHtml(html);
      const rules = src.ruleExplore ?? {};
      const items = extractBookList(doc, rules, { baseUrl: src.bookSourceUrl, result: html });
      if (seq !== reqIdRef.current) return;
      setBooks(items.filter((i) => i.name).map((i) => ({
        title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
        bookUrl: i.bookUrl ?? "", sourceId, sourceName,
      })));
      setActive(cat); setPage(pg);
    } catch (e) {
      if (seq !== reqIdRef.current) return;
      setBooks([]);
      setError(String(e));
    } finally {
      if (seq === reqIdRef.current) setBusy(false);
    }
  }, [src, sourceId, sourceName]);

  const canPage = active ? active.url.includes("{{page}}") : false;

  return (
    <div className="discover page">
      <header className="library-header">
        <div className="brand"><h1>{sourceName} · 浏览</h1></div>
        <button className="btn btn-ghost" onClick={onBack}>返回</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="explore-cats">
        {categories.length === 0 ? <p className="panel-empty">此书源无分类</p> : categories.map((c) => (
          <button key={c.url} className={`btn btn-ghost${active?.url === c.url ? " active" : ""}`} onClick={() => void loadCategory(c, 1)}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="discover-results">
        {busy ? <p className="panel-empty">加载中…</p> : books.length === 0 ? (
          active ? <p className="panel-empty">该分类暂无书籍</p> : <p className="panel-empty">选择一个分类开始浏览</p>
        ) : (
          <>
            {books.map((h, i) => (
              <div className="hit-card" key={`${h.sourceId}-${h.bookUrl}-${i}`} onClick={() => onOpenBook(h)}>
                <div className="hit-info">
                  <span className="hit-title">{h.title}</span>
                  <span className="hit-author">{h.author}</span>
                </div>
                <span className="hit-source">{h.sourceName}</span>
              </div>
            ))}
            {canPage && (
              <button className="btn btn-ghost" onClick={() => active && void loadCategory(active, page + 1)} disabled={busy}>
                下一页
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
