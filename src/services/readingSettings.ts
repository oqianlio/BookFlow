import { getSetting, setSetting } from "./api";
import type { Conversion } from "./tradSimpl";

export type PageMode = "scroll" | "cover" | "slide";

export interface ReadingSettings {
  pageMode: PageMode;
  fontSizePx: number;
  lineHeight: number;
  bgTheme: string;
  letterSpacingPx: number;
  paragraphSpacingPx: number;
  indentEm: number;
  bold: boolean;
  fontFamily: string;
  conversion: Conversion;
}

export const BG_THEMES: Array<{ id: string; name: string; bg: string; fg: string }> = [
  { id: "paper", name: "纸白", bg: "#ffffff", fg: "#1c1b1b" },
  { id: "beige", name: "纸黄", bg: "#f5e9d0", fg: "#2b2b2b" },
  { id: "green", name: "护眼绿", bg: "#cde8cd", fg: "#1f1f1f" },
  { id: "night", name: "夜间", bg: "#141313", fg: "#e5e2e1" },
];

export const FONT_PRESETS: Array<{ id: string; name: string; css: string }> = [
  { id: "serif", name: "衬线", css: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif' },
  { id: "sans", name: "黑体", css: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
  { id: "kai", name: "楷体", css: '"Kaiti SC", KaiTi, "STKaiti", "Noto Serif SC", serif' },
  { id: "yuan", name: "圆体", css: '"Yuanti SC", "YouYuan", "Microsoft YaHei", sans-serif' },
];

export function resolveFontCss(fontFamily: string): string {
  const hit = FONT_PRESETS.find((f) => f.id === fontFamily);
  if (hit) return hit.css;
  return fontFamily.trim() || FONT_PRESETS[0].css;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  pageMode: "scroll",
  fontSizePx: 18,
  lineHeight: 1.8,
  bgTheme: "paper",
  letterSpacingPx: 0,
  paragraphSpacingPx: 11,
  indentEm: 0,
  bold: false,
  fontFamily: "serif",
  conversion: "none",
};

const PAGE_MODES: PageMode[] = ["scroll", "cover", "slide"];
const CONVERSIONS: Conversion[] = ["none", "simp", "trad"];
const FONT_MIN = 14;
const FONT_MAX = 24;
const LINE_MIN = 1.4;
const LINE_MAX = 2.4;
const SPACE_MIN = 0;
const SPACE_MAX = 4;
const PARA_MIN = 0;
const PARA_MAX = 24;
const INDENT_MIN = 0;
const INDENT_MAX = 2;

function numInRange(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

export async function loadReadingSettings(): Promise<ReadingSettings> {
  try {
    const [mode, size, line, bg, ls, ps, ind, bld, fam, conv] = await Promise.all([
      getSetting("reading.pageMode"),
      getSetting("reading.fontSizePx"),
      getSetting("reading.lineHeight"),
      getSetting("reading.bgTheme"),
      getSetting("reading.letterSpacingPx"),
      getSetting("reading.paragraphSpacingPx"),
      getSetting("reading.indentEm"),
      getSetting("reading.bold"),
      getSetting("reading.fontFamily"),
      getSetting("reading.conversion"),
    ]);
    const pageMode = PAGE_MODES.includes(mode as PageMode)
      ? (mode as PageMode)
      : DEFAULT_READING_SETTINGS.pageMode;
    const bgTheme = BG_THEMES.some((t) => t.id === bg) ? bg! : DEFAULT_READING_SETTINGS.bgTheme;
    return {
      pageMode,
      fontSizePx: numInRange(size, FONT_MIN, FONT_MAX, DEFAULT_READING_SETTINGS.fontSizePx),
      lineHeight: numInRange(line, LINE_MIN, LINE_MAX, DEFAULT_READING_SETTINGS.lineHeight),
      bgTheme,
      letterSpacingPx: numInRange(ls, SPACE_MIN, SPACE_MAX, DEFAULT_READING_SETTINGS.letterSpacingPx),
      paragraphSpacingPx: numInRange(ps, PARA_MIN, PARA_MAX, DEFAULT_READING_SETTINGS.paragraphSpacingPx),
      indentEm: numInRange(ind, INDENT_MIN, INDENT_MAX, DEFAULT_READING_SETTINGS.indentEm),
      bold: bld === "1",
      fontFamily: fam && fam.trim() ? fam : DEFAULT_READING_SETTINGS.fontFamily,
      conversion: CONVERSIONS.includes(conv as Conversion) ? conv as Conversion : DEFAULT_READING_SETTINGS.conversion,
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
    setSetting("reading.letterSpacingPx", String(s.letterSpacingPx)),
    setSetting("reading.paragraphSpacingPx", String(s.paragraphSpacingPx)),
    setSetting("reading.indentEm", String(s.indentEm)),
    setSetting("reading.bold", s.bold ? "1" : "0"),
    setSetting("reading.fontFamily", s.fontFamily),
    setSetting("reading.conversion", s.conversion),
  ]);
}
