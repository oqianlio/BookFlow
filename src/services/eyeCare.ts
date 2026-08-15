import { getSetting, setSetting } from "./api";

export interface EyeCareSettings {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

const DEFAULT_EYE_CARE: EyeCareSettings = { enabled: false, start: "22:00", end: "06:00" };

const TIME_RE = /^\d{2}:\d{2}$/;

export async function loadEyeCare(): Promise<EyeCareSettings> {
  try {
    const [enabled, start, end] = await Promise.all([
      getSetting("eyeCare.enabled"),
      getSetting("eyeCare.start"),
      getSetting("eyeCare.end"),
    ]);
    return {
      enabled: enabled === "1",
      start: start && TIME_RE.test(start) ? start : DEFAULT_EYE_CARE.start,
      end: end && TIME_RE.test(end) ? end : DEFAULT_EYE_CARE.end,
    };
  } catch {
    return { ...DEFAULT_EYE_CARE };
  }
}

export async function saveEyeCare(s: EyeCareSettings): Promise<void> {
  await Promise.all([
    setSetting("eyeCare.enabled", s.enabled ? "1" : "0"),
    setSetting("eyeCare.start", s.start),
    setSetting("eyeCare.end", s.end),
  ]);
}

export function isInNightWindow(now: Date, start: string, end: string): boolean {
  const toMin = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMin(start);
  const e = toMin(end);
  if (s === e) return false; // 起止相同视为不启用
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e; // 跨午夜
}
