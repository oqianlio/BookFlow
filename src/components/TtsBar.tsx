import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "../services/api";
import { VolumeIcon } from "./icons";

const RATE_KEY = "tts_rate";

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

export default function TtsBar() {
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);

  const getSelectedText = (): string => {
    const sel = window.getSelection()?.toString() ?? "";
    return sel.trim();
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
    try {
      await invoke("tts_stop");
    } finally {
      setBusy(false);
      setReading(false);
    }
  };

  useEffect(() => () => { void invoke("tts_stop").catch(() => {}); }, []);

  return (
    <button
      className={`btn-icon${reading ? " active" : ""}`}
      onClick={() => { void (reading ? stop() : speak()); }}
      disabled={busy}
      aria-label={reading ? "停止朗读" : "朗读选中"}
      title={reading ? "停止朗读" : "朗读选中"}
    >
      <VolumeIcon size={17} />
    </button>
  );
}
