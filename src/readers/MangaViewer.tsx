export default function MangaViewer({ images, onError }: { images: string[]; onError?: (msg: string) => void }) {
  if (images.length === 0) return <p className="panel-empty">无图片</p>;
  return (
    <div className="manga-viewer">
      {images.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          loading="lazy"
          alt={`图片 ${i + 1}`}
          onError={() => onError?.(`图片加载失败: ${src}`)}
        />
      ))}
    </div>
  );
}
