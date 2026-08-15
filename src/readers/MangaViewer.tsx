import { useCallback, useEffect, useRef, useState } from "react";

export default function MangaViewer({ images, onReachEnd }: {
  images: string[];
  onError?: (msg: string) => void;
  onReachEnd?: () => void;
}) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const lastElRef = useRef<HTMLElement | null>(null);
  const lastRef = useCallback((el: HTMLElement | null) => { lastElRef.current = el; }, []);
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  useEffect(() => { setFailed(new Set()); }, [images]);

  // 最后一张图进入视口 → 通知上层衔接下一话（触发一次后断开）
  useEffect(() => {
    if (images.length === 0 || typeof IntersectionObserver === "undefined") return;
    const el = lastElRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        obs.disconnect();
        onReachEndRef.current?.();
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [images]);

  if (images.length === 0) return <p className="panel-empty">无图片</p>;
  const markFailed = (i: number) => {
    setFailed((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  };
  const retry = (i: number) => {
    setFailed((prev) => {
      if (!prev.has(i)) return prev;
      const next = new Set(prev);
      next.delete(i);
      return next;
    });
  };
  return (
    <div className="manga-viewer">
      {images.map((src, i) => {
        const isLast = i === images.length - 1;
        return failed.has(i) ? (
          <div key={`${src}-${i}`} className="manga-viewer-failed" ref={isLast ? lastRef : undefined}>
            图片加载失败
            <button className="btn btn-ghost manga-viewer-retry" onClick={() => retry(i)}>重试</button>
          </div>
        ) : (
          <img
            key={`${src}-${i}`}
            src={src}
            loading="lazy"
            alt={`图片 ${i + 1}`}
            ref={isLast ? lastRef : undefined}
            onError={() => markFailed(i)}
          />
        );
      })}
      {failed.size > 0 && <p className="manga-viewer-notice">{failed.size} 张图片加载失败</p>}
    </div>
  );
}
