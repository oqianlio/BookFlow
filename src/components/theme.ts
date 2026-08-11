import { getSetting, setSetting } from "../services/api";

export type ThemeScheme = "sora" | "koharu" | "yuuka" | "phoebe" | "wh";
export type ThemeMode = "light" | "dark";
export interface Theme { scheme: ThemeScheme; mode: ThemeMode }

export const SCHEMES: ThemeScheme[] = ["sora", "koharu", "yuuka", "phoebe", "wh"];
export const SCHEME_NAMES: Record<ThemeScheme, string> = {
  sora: "Sora 青", koharu: "Koharu 樱", yuuka: "Yuuka 紫", phoebe: "Phoebe 橙", wh: "WH 灰",
};

export function parseTheme(saved: string | null): Theme {
  if (!saved) return { scheme: "sora", mode: "light" };
  const [rawScheme, rawMode] = saved.split(":");
  const scheme: ThemeScheme = (SCHEMES as string[]).includes(rawScheme) ? rawScheme as ThemeScheme : "sora";
  const mode: ThemeMode = rawMode === "dark" || saved === "dark" ? "dark" : "light";
  return { scheme, mode };
}

const listeners = new Set<() => void>();

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-scheme", t.scheme);
  root.setAttribute("data-mode", t.mode);
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getTheme(): Theme {
  const scheme = document.documentElement.getAttribute("data-scheme") as ThemeScheme | null;
  const mode = document.documentElement.getAttribute("data-mode") as ThemeMode | null;
  return {
    scheme: scheme && (SCHEMES as string[]).includes(scheme) ? scheme : "sora",
    mode: mode === "dark" ? "dark" : "light",
  };
}

export async function setTheme(t: Theme) {
  applyTheme(t);
  await setSetting("theme", `${t.scheme}:${t.mode}`);
}

export async function initTheme() {
  const saved = await getSetting("theme");
  applyTheme(parseTheme(saved));
}

export function getFontSize(): number {
  return Number(localStorage.getItem("reader.fontSize") ?? "18");
}

export async function setFontSize(n: number) {
  localStorage.setItem("reader.fontSize", String(n));
  applyFontSize(n);
  await setSetting("font_size", String(n));
}

export function applyFontSize(n: number) {
  document.documentElement.style.fontSize = `${n}px`;
}
