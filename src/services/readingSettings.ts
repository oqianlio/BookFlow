import { getSetting, setSetting } from "./api";

export type PageMode = "scroll" | "cover" | "slide";

export interface ReadingSettings {
  pageMode: PageMode;
  fontSizePx: number;
  lineHeight: number;
  bgTheme: string;
}

export const BG_THEMES: Array<{ id: string; name: string; bg: string; fg: string }> = [
  { id: "paper", name: "纸白", bg: "#ffffff", fg: "#1c1b1b" },
  { id: "beige", name: "纸黄", bg: "#f5e9d0", fg: "#2b2b2b" },
  { id: "green", name: "护眼绿", bg: "#cde8cd", fg: "#1f1f1f" },
  { id: "night", name: "夜间", bg: "#141313", fg: "#e5e2e1" },
];

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  pageMode: "scroll",
  fontSizePx: 18,
  lineHeight: 1.8,
  bgTheme: "paper",
};

const PAGE_MODES: PageMode[] = ["scroll", "cover", "slide"];
const FONT_MIN = 14;
const FONT_MAX = 24;
const LINE_MIN = 1.4;
const LINE_MAX = 2.4;

export async function loadReadingSettings(): Promise<ReadingSettings> {
  try {
    const [mode, size, line, bg] = await Promise.all([
      getSetting("reading.pageMode"),
      getSetting("reading.fontSizePx"),
      getSetting("reading.lineHeight"),
      getSetting("reading.bgTheme"),
    ]);
    const pageMode = PAGE_MODES.includes(mode as PageMode)
      ? (mode as PageMode)
      : DEFAULT_READING_SETTINGS.pageMode;
    const fontSizePx = Number(size);
    const lineHeight = Number(line);
    const bgTheme = BG_THEMES.some((t) => t.id === bg) ? bg! : DEFAULT_READING_SETTINGS.bgTheme;
    return {
      pageMode,
      fontSizePx:
        Number.isFinite(fontSizePx) && fontSizePx >= FONT_MIN && fontSizePx <= FONT_MAX
          ? fontSizePx
          : DEFAULT_READING_SETTINGS.fontSizePx,
      lineHeight:
        Number.isFinite(lineHeight) && lineHeight >= LINE_MIN && lineHeight <= LINE_MAX
          ? lineHeight
          : DEFAULT_READING_SETTINGS.lineHeight,
      bgTheme,
    };
  } catch {
    return { ...DEFAULT_READING_SETTINGS };
  }
}

export async function saveReadingSettings(s: ReadingSettings): Promise<void> {
  await Promise.all([
    setSetting("reading.pageMode", s.pageMode),
    setSetting("reading.fontSizePx", String(s.fontSizePx)),
    setSetting("reading.lineHeight", String(s.lineHeight)),
    setSetting("reading.bgTheme", s.bgTheme),
  ]);
}
