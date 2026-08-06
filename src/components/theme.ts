import { getSetting, setSetting } from "../services/api";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getTheme(): Theme {
  return (document.documentElement.getAttribute("data-theme") as Theme) || "light";
}

export async function setTheme(theme: Theme) {
  applyTheme(theme);
  await setSetting("theme", theme);
}

export async function initTheme() {
  const saved = await getSetting("theme");
  applyTheme(saved === "dark" ? "dark" : "light");
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
