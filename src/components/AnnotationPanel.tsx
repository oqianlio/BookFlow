import { useCallback, useEffect, useState } from "react";
import { addAnnotation, deleteAnnotation, listAnnotations } from "../services/api";

export interface AnnotationItem {
  id: number; book_id: number; format: string; location: string;
  text: string; note: string | null; color: string; created_at: number;
}

export default function AnnotationPanel({ bookId, format, onJump, onChanged, onClose }: {
  bookId: number; format?: string; onJump: (loc: string) => void; onChanged: () => void; onClose?: () => void;
}) {
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [text, setText] = useState("");
  const [color, setColor] = useState("yellow");

  const refresh = useCallback(async () => {
    setItems((await listAnnotations(bookId)) as AnnotationItem[]);
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!text.trim()) return;
    await addAnnotation({ bookId, format: format ?? "manual", location: locationHref(), text, color });
    setText("");
    await refresh();
    onChanged();
    window.dispatchEvent(new CustomEvent("annotation-changed"));
  };

  function locationHref(): string {
    const w = window as any;
    return w.__readerLocation ?? "";
  }

  const handleDelete = async (id: number) => {
    await deleteAnnotation(id);
    await refresh();
    onChanged();
    window.dispatchEvent(new CustomEvent("annotation-changed"));
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h3>标注</h3>
        <button className="btn-icon panel-close" onClick={() => onClose?.()} aria-label="关闭标注" title="关闭">×</button>
      </div>
      {items.length === 0 ? <p className="panel-empty">暂无标注</p> : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className={`annotation annotation-${a.color}`}>
              <p onClick={() => onJump(a.location)}>{a.text}</p>
              <button onClick={() => handleDelete(a.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-add">
        <input aria-label="标注文本" value={text} onChange={(e) => setText(e.target.value)} placeholder="标注内容" />
        <select aria-label="颜色" value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="yellow">黄</option>
          <option value="green">绿</option>
          <option value="blue">蓝</option>
          <option value="pink">粉</option>
        </select>
        <button className="btn-primary" onClick={handleAdd} disabled={!text.trim()}>添加标注</button>
      </div>
    </aside>
  );
}
