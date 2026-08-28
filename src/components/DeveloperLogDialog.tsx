import { useCallback, useEffect, useRef, useState } from "react";
import { readLogs, clearLogs, logFileSize } from "../services/api";
import { formatBytes } from "../utils/format";
import { useError } from "./ErrorDialog";

type Level = "all" | "error" | "warn";

/** 从日志行解析级别：`[2026-08-16 14:00:00] [error] msg` */
function levelOf(line: string): Level {
  const m = line.match(/\[(error|warn)\]/);
  return m ? (m[1] as Level) : "all";
}

export default function DeveloperLogDialog({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState<Level>("all");
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const { showError } = useError();
  const bodyRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [ls, sz] = await Promise.all([readLogs(500), logFileSize()]);
      setLines(ls);
      setSize(sz);
    } catch (e) {
      showError(String(e));
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 新日志到达时自动滚动到底部（jsdom 无 scrollTo，需容错）
  useEffect(() => {
    try {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
    } catch {
      // 非浏览器环境忽略
    }
  }, [lines.length]);

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearLogs();
      await refresh();
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const text = filteredLines.join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  const filteredLines = filter === "all" ? lines : lines.filter((l) => levelOf(l) === filter);

  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog dev-log-dialog" role="dialog" aria-label="开发者日志" onClick={(e) => e.stopPropagation()}>
        <h3>开发者日志</h3>
        <div className="dev-log-toolbar">
          {(["all", "error", "warn"] as const).map((lv) => (
            <button
              key={lv}
              className={`btn btn-soft ${filter === lv ? "active" : ""}`}
              onClick={() => setFilter(lv)}
            >
              {lv === "all" ? "全部" : lv === "error" ? "错误" : "警告"}
            </button>
          ))}
          <span className="dev-log-spacer" />
          <button className="btn btn-soft" onClick={() => void refresh()}>刷新</button>
          <button className="btn btn-soft" onClick={() => void handleCopy()}>复制</button>
          <button className="btn btn-soft" onClick={() => void handleClear()} disabled={busy}>
            {busy ? "清空中…" : "清空"}
          </button>
        </div>
        <div className="dev-log-size">{lines.length} 行 · {formatBytes(size)}</div>
        <div className="dev-log-body" ref={bodyRef}>
          {filteredLines.length === 0 ? (
            <div className="dev-log-empty">暂无日志</div>
          ) : (
            filteredLines.map((l, i) => (
              <div key={i} className={`dev-log-line ${levelOf(l) === "all" ? "" : `is-${levelOf(l)}`}`}>{l}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
