import { useEffect, useState } from "react";

export default function MangaViewer({ images }: { images: string[]; onError?: (msg: string) => void }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  useEffect(() => { setFailed(new Set()); }, [images]);
  if (images.length === 0) return <p className="panel-empty">无图片</p>;
  const markFailed = (i: number) => {
    setFailed((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  };
  return (
    <div className="manga-viewer">
      {images.map((src, i) =>
        failed.has(i) ? (
          <div key={`${src}-${i}`} className="manga-viewer-failed">图片加载失败</div>
        ) : (
          <img
            key={`${src}-${i}`}
            src={src}
            loading="lazy"
            alt={`图片 ${i + 1}`}
            onError={() => markFailed(i)}
          />
        ),
      )}
      {failed.size > 0 && <p className="manga-viewer-notice">{failed.size} 张图片加载失败</p>}
    </div>
  );
}
