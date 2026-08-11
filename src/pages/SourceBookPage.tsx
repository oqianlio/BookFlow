import { useEffect, useState } from "react";
import { httpGet, openLoginWindow, mergeUserAgent } from "../services/api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, type BookSource } from "../services/bookSourceEngine";

interface TocItem { name: string; url: string }

export default function SourceBookPage({ sourceId, sourceName, bookUrl, initialTitle, onBack, onRead }: {
  sourceId: number; sourceName: string; bookUrl: string; initialTitle: string;
  onBack: () => void; onRead: (index: number, url: string, name: string) => void;
}) {
  const [info, setInfo] = useState({ title: initialTitle, author: "", intro: "", coverUrl: "" });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<BookSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bs = await (await import("../services/api")).listBookSources().then((l) => l.find((x) => x.id === sourceId));
        if (!bs) { setError("书源不存在"); return; }
        const s = parseBookSourceJson(bs.json);
        if (!cancelled) setSource(s);
        if (!bookUrl) { setError("书籍地址无效，无法打开"); return; }
        const base = s.bookSourceUrl || bookUrl;
        const resolvedBookUrl = bookUrl.startsWith("http") ? bookUrl : new URL(bookUrl, base).toString();
        const html = await httpGet(resolvedBookUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined);
        const doc = parseHtml(html);
        const bi = s.ruleBookInfo ?? {};
        const title = bi.name ? extractSingle(doc, bi.name) : initialTitle;
        const author = bi.author ? extractSingle(doc, bi.author) : "";
        const intro = bi.intro ? extractSingle(doc, bi.intro) : "";
        const cover = bi.coverUrl ? extractSingle(doc, bi.coverUrl) : "";
        const tocUrl = bi.tocUrl ? extractSingle(doc, bi.tocUrl, { baseUrl: resolvedBookUrl }) : resolvedBookUrl;
        const tocHtml = tocUrl === resolvedBookUrl ? html : await httpGet(tocUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined);
        const tocDoc = parseHtml(tocHtml);
        const rules = s.ruleToc ?? {};
        const items = extractList(tocDoc, rules.chapterList ?? "", {
          name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
        }, { baseUrl: tocUrl, result: tocHtml });
        const tocItems = items.filter((i) => i.url).map((i) => ({
          name: i.name || "未命名章节",
          url: i.url.startsWith("http") ? i.url : new URL(i.url, tocUrl).toString(),
        }));
        if (!cancelled) {
          setInfo({ title: title || initialTitle, author, intro, coverUrl: cover });
          setToc(tocItems);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, bookUrl, initialTitle]);

  const handleLogin = () => {
    if (!source?.loginUrl) return;
    let host = "";
    try { host = new URL(source.bookSourceUrl).hostname; } catch { host = source.bookSourceUrl; }
    void openLoginWindow(source.loginUrl, host);
  };

  return (
    <div className="source-book page">
      <header className="library-header">
        <div className="brand"><h1>{info.title}</h1></div>
        <div className="library-actions">
          {source?.loginUrl && <button className="btn btn-ghost" onClick={handleLogin}>登录</button>}
          <button className="btn btn-ghost" onClick={onBack}>返回</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="source-book-info">
        <span className="source-name">{sourceName}</span>
        {info.author && <span className="hit-author">{info.author}</span>}
        {info.intro && <p className="source-intro">{info.intro}</p>}
        <button className="btn btn-primary" onClick={() => onRead(-1, "", "")}>开始阅读</button>
      </div>
      <div className="source-toc">
        {toc.length === 0 ? (
          <p className="panel-empty">暂无目录</p>
        ) : (
          <ol>
            {toc.map((t, idx) => (
              <li key={`${t.url}-${idx}`}>
                <button className="btn btn-ghost" onClick={() => onRead(idx, t.url, t.name)}>{t.name}</button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
