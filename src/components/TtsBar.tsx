import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function TtsBar() {
  const [rate, setRate] = useState(1.0);
  const [reading, setReading] = useState(false);

  const getSelectedText = (): string => {
    const sel = window.getSelection()?.toString() ?? "";
    return sel.trim();
  };

  const speak = async () => {
    const text = getSelectedText() || "当前没有选中文本，请先选中要朗读的内容。";
    await invoke("tts_speak", { text, rate });
    setReading(true);
  };

  const stop = async () => {
    await invoke("tts_stop");
    setReading(false);
  };

  return (
    <div className="tts-bar">
      <button className="btn-secondary" onClick={speak}>{reading ? "重新朗读" : "朗读选中"}</button>
      <button className="btn-secondary" onClick={stop}>停止</button>
      <label htmlFor="rate">语速</label>
      <input id="rate" type="range" min={0.5} max={2} step={0.1} value={rate}
        onChange={(e) => setRate(parseFloat(e.target.value))} />
      <span>{rate.toFixed(1)}x</span>
    </div>
  );
}
