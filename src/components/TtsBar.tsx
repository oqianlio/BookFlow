import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "../services/api";
import { VolumeIcon, TimerIcon } from "./icons";

const RATE_KEY = "tts_rate";
const SLEEP_OPTIONS = [5, 10, 15, 30, 60] as const;

export async function getTtsRate(): Promise<number> {
  const local = Number(localStorage.getItem("reader.ttsRate"));
  if (Number.isFinite(local) && local >= 0.5 && local <= 2) return local;
  const saved = await getSetting(RATE_KEY);
  const v = Number(saved);
  return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1;
}

export async function setTtsRate(rate: number): Promise<void> {
  const v = Math.min(2, Math.max(0.5, rate));
  localStorage.setItem("reader.ttsRate", String(v));
  await setSetting(RATE_KEY, String(v));
}

function formatRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export default function TtsBar() {
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  // 睡眠定时：null=未设置，number=剩余秒数
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepTimerRef = useRef<number | null>(null);

  const getSelectedText = (): string => {
    const sel = window.getSelection()?.toString() ?? "";
    return sel.trim();
  };

  const stopTts = async () => {
    try { await invoke("tts_stop"); } catch { /* ignore */ }
    setReading(false);
  };

  const speak = async () => {
    setBusy(true);
    try {
      const rate = await getTtsRate();
      const text = getSelectedText() || "当前没有选中文本，请先选中要朗读的内容。";
      await invoke("tts_speak", { text, rate });
      setReading(true);
    } catch {
      // 朗读启动失败：保持按钮原状即可
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    clearSleepTimer();
    await stopTts();
    setBusy(false);
  };

  // ==== 睡眠定时 ====
  const clearSleepTimer = () => {
    if (sleepTimerRef.current != null) {
      window.clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepRemaining(null);
  };

  const startSleepTimer = (minutes: number) => {
    clearSleepTimer();
    const totalSec = minutes * 60;
    setSleepRemaining(totalSec);
    sleepTimerRef.current = window.setInterval(() => {
      setSleepRemaining((prev) => {
        if (prev == null || prev <= 1) {
          // 时间到：停止朗读
          void stopTts();
          clearSleepTimer();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    setShowSleepMenu(false);
  };

  // 组件卸载时清理定时器
  useEffect(() => () => {
    if (sleepTimerRef.current != null) window.clearInterval(sleepTimerRef.current);
  }, []);

  return (
    <div className="tts-bar-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 2, position: "relative" }}>
      <button
        className={`btn-icon${reading ? " active" : ""}`}
        onClick={() => { void (reading ? stop() : speak()); }}
        disabled={busy}
        aria-label={reading ? "停止朗读" : "朗读选中"}
        title={reading ? "停止朗读" : "朗读选中"}
      >
        <VolumeIcon size={17} />
      </button>
      {/* 睡眠定时按钮（朗读中才显示） */}
      {reading && (
        <button
          className={`btn-icon${sleepRemaining != null ? " active" : ""}`}
          onClick={() => setShowSleepMenu((v) => !v)}
          aria-label={sleepRemaining != null ? `睡眠定时 ${formatRemaining(sleepRemaining)}` : "设置睡眠定时"}
          title={sleepRemaining != null ? `剩余 ${formatRemaining(sleepRemaining)}` : "睡眠定时"}
          style={{ fontSize: 11 }}
        >
          <TimerIcon size={15} />
        </button>
      )}
      {/* 睡眠定时下拉菜单 */}
      {showSleepMenu && reading && (
        <div className="tts-sleep-menu">
          <div className="tts-sleep-title">停止时间</div>
          {SLEEP_OPTIONS.map((m) => (
            <button key={m} type="button" className="tts-sleep-option" onClick={() => startSleepTimer(m)}>
              {m} 分钟
            </button>
          ))}
          {sleepRemaining != null && (
            <button type="button" className="tts-sleep-option tts-sleep-cancel" onClick={() => { clearSleepTimer(); setShowSleepMenu(false); }}>
              取消定时
            </button>
          )}
        </div>
      )}
      {/* 剩余时间指示 */}
      {sleepRemaining != null && reading && (
        <span className="tts-sleep-ind" style={{ fontSize: 11, color: "var(--primary)", whiteSpace: "nowrap" }}>
          {formatRemaining(sleepRemaining)}
        </span>
      )}
    </div>
  );
}
