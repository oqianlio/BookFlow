import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { getRssArticle, type RssArticleRow } from "../services/api";
import { useError } from "../components/ErrorDialog";

export default function RssArticlePage({ articleId, onBack }: {
  articleId: number; onBack: () => void;
}) {
  const [article, setArticle] = useState<RssArticleRow | null>(null);
  const { showError } = useError();

  useEffect(() => {
    let cancelled = false;
    void getRssArticle(articleId).then((a) => {
      if (cancelled) return;
      if (!a) { showError("文章不存在"); return; }
      setArticle(a);
    }).catch((e) => { if (!cancelled) showError(String(e)); });
    return () => { cancelled = true; };
  }, [articleId, showError]);

  const content = article?.content?.trim() ? article.content : "<p>无正文内容</p>";

  return (
    <div className="rss-article page">
      <header className="library-header">
        <div className="brand"><h1>{article?.title ?? "文章"}</h1></div>
        <div className="library-actions">
          {article?.link && <a className="btn btn-ghost" href={article.link} target="_blank" rel="noreferrer">原文链接</a>}
          <button className="btn btn-ghost" onClick={onBack}>返回</button>
        </div>
      </header>
      <div className="md-reader">
        <div className="md-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
      </div>
    </div>
  );
}
