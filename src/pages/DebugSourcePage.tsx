import { useEffect, useState } from "react";
import { listBookSources } from "../services/api";
import { debugSource, type DebugResult } from "../services/sourceDebug";

type Stage = "search" | "toc" | "content";

const STAGES: Array<{ value: Stage; label: string; placeholder: string }> = [
  { value: "search", label: "搜索", placeholder: "输入关键词（自动套用搜索规则）" },
  { value: "toc", label: "目录", placeholder: "输入书籍页 URL" },
  { value: "content", label: "正文", placeholder: "输入章节页 URL" },
];

export default function DebugSourcePage({ sourceId, sourceName, onBack }: {
  sourceId: number; sourceName: string; onBack: () => void;
}) {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("search");
  const [result, setResult] = useState<DebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState<{ json: string } | null>(null);

  const loadSource = async () => {
    const bs = (await listBookSources()).find((s) => s.id === sourceId);
    if (!bs) { setError("书源不存在"); return; }
    setError(null);
    setSrc(bs);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bs = (await listBookSources()).find((s) => s.id === sourceId);
        if (!bs) { if (!cancelled) setError("书源不存在"); return; }
        if (!cancelled) setSrc(bs);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId]);

  const run = async () => {
    if (!src || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await debugSource(src, stage, url));
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (busy) return;
    setError(null);
    try {
      if (src) {
        await run();
      } else {
        await loadSource();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const meta = STAGES.find((s) => s.value === stage) ?? STAGES[0];

  return (
    <div className="debug-source page">
      <header className="library-header">
        <div className="brand"><h1>{sourceName} · 调试</h1></div>
        <div className="library-actions">
          <button className="btn btn-ghost" onClick={onBack}>返回</button>
        </div>
      </header>
      {error && (
        <div className="debug-error">
          <p className="error">{error}</p>
          <button className="btn btn-ghost" onClick={() => void retry()}>重试</button>
        </div>
      )}
      <div className="debug-controls">
        <div className="segmented" role="group" aria-label="调试阶段">
          {STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={stage === s.value ? "active" : ""}
              onClick={() => setStage(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="debug-input-row">
          <input
            aria-label="URL 或关键词"
            value={url}
            placeholder={meta.placeholder}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
          />
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !src}>
            {busy ? "运行中…" : "运行"}
          </button>
        </div>
      </div>
      {busy && <p className="panel-empty">运行中…</p>}
      {result && (
        <div className="debug-result">
          <details className="debug-html">
            <summary>HTML 摘要</summary>
            <pre>{result.html}</pre>
          </details>
          <h3>解析字段</h3>
          {result.fields.length === 0 ? (
            <p className="panel-empty">无字段</p>
          ) : (
            <div className="debug-fields">
              {result.fields.map((f, i) => (
                <div className="debug-field" key={`${f.name}-${i}`}>
                  <span className="debug-field-name">{f.name}</span>
                  <span className="debug-field-value">{f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
