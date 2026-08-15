import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import {
  loadReadingSettings,
  saveReadingSettings,
  BG_THEMES,
  DEFAULT_READING_SETTINGS,
  resolveFontCss,
} from "./readingSettings";

vi.mock("./api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("readingSettings", () => {
  it("returns defaults when no keys saved", async () => {
    vi.mocked(api.getSetting).mockResolvedValue(null);
    const s = await loadReadingSettings();
    expect(s).toEqual(DEFAULT_READING_SETTINGS);
  });

  it("loads saved values per key and falls back per missing key", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.pageMode") return "cover";
      if (k === "reading.fontSizePx") return "20";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s.pageMode).toBe("cover");
    expect(s.fontSizePx).toBe(20);
    expect(s.lineHeight).toBe(DEFAULT_READING_SETTINGS.lineHeight);
    expect(s.bgTheme).toBe(DEFAULT_READING_SETTINGS.bgTheme);
  });

  it("sanitizes invalid saved values back to defaults", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.pageMode") return "diagonal";
      if (k === "reading.fontSizePx") return "999";
      if (k === "reading.lineHeight") return "0.1";
      if (k === "reading.bgTheme") return "neon";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s).toEqual(DEFAULT_READING_SETTINGS);
  });

  it("saveReadingSettings persists all four keys", async () => {
    await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, pageMode: "slide", fontSizePx: 21, lineHeight: 2.0, bgTheme: "night" });
    expect(api.setSetting).toHaveBeenCalledWith("reading.pageMode", "slide");
    expect(api.setSetting).toHaveBeenCalledWith("reading.fontSizePx", "21");
    expect(api.setSetting).toHaveBeenCalledWith("reading.lineHeight", "2");
    expect(api.setSetting).toHaveBeenCalledWith("reading.bgTheme", "night");
  });

  it("exposes four preset background themes", () => {
    expect(BG_THEMES.map((t) => t.id)).toEqual(["paper", "beige", "green", "night"]);
  });

  it("includes typography defaults", async () => {
    vi.mocked(api.getSetting).mockResolvedValue(null);
    const s = await loadReadingSettings();
    expect(s.letterSpacingPx).toBe(0);
    expect(s.paragraphSpacingPx).toBe(11);
    expect(s.indentEm).toBe(0);
    expect(s.bold).toBe(false);
    expect(s.fontFamily).toBe("serif");
  });

  it("loads and sanitizes typography values", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.letterSpacingPx") return "1.5";
      if (k === "reading.paragraphSpacingPx") return "16";
      if (k === "reading.indentEm") return "1";
      if (k === "reading.bold") return "1";
      if (k === "reading.fontFamily") return "sans";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s.letterSpacingPx).toBe(1.5);
    expect(s.paragraphSpacingPx).toBe(16);
    expect(s.indentEm).toBe(1);
    expect(s.bold).toBe(true);
    expect(s.fontFamily).toBe("sans");
  });

  it("falls back to defaults for invalid typography values", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.letterSpacingPx") return "99";
      if (k === "reading.paragraphSpacingPx") return "-5";
      if (k === "reading.indentEm") return "9";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s.letterSpacingPx).toBe(0);
    expect(s.paragraphSpacingPx).toBe(11);
    expect(s.indentEm).toBe(0);
  });

  it("saveReadingSettings persists typography keys", async () => {
    await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, letterSpacingPx: 2, paragraphSpacingPx: 14, indentEm: 1.5, bold: true, fontFamily: "kai" });
    expect(api.setSetting).toHaveBeenCalledWith("reading.letterSpacingPx", "2");
    expect(api.setSetting).toHaveBeenCalledWith("reading.paragraphSpacingPx", "14");
    expect(api.setSetting).toHaveBeenCalledWith("reading.indentEm", "1.5");
    expect(api.setSetting).toHaveBeenCalledWith("reading.bold", "1");
    expect(api.setSetting).toHaveBeenCalledWith("reading.fontFamily", "kai");
  });

  it("resolveFontCss maps presets and passes through custom names", () => {
    expect(resolveFontCss("serif")).toContain("Georgia");
    expect(resolveFontCss("custom-font")).toBe("custom-font");
    expect(resolveFontCss("")).toContain("Georgia");
  });

  it("conversion defaults to none", async () => {
    vi.mocked(api.getSetting).mockResolvedValue(null);
    const s = await loadReadingSettings();
    expect(s.conversion).toBe("none");
  });

  it("loads and sanitizes conversion", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.conversion") return "trad";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s.conversion).toBe("trad");
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.conversion") return "weird";
      return null;
    });
    const s2 = await loadReadingSettings();
    expect(s2.conversion).toBe("none");
  });

  it("saveReadingSettings persists conversion", async () => {
    await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, conversion: "simp" });
    expect(api.setSetting).toHaveBeenCalledWith("reading.conversion", "simp");
  });

  it("loads custom theme colors and allows custom bgTheme", async () => {
    vi.mocked(api.getSetting).mockImplementation(async (k) => {
      if (k === "reading.bgTheme") return "custom";
      if (k === "reading.customBg") return "#123456";
      if (k === "reading.customFg") return "#abcdef";
      return null;
    });
    const s = await loadReadingSettings();
    expect(s.bgTheme).toBe("custom");
    expect(s.customBg).toBe("#123456");
    expect(s.customFg).toBe("#abcdef");
  });

  it("saveReadingSettings persists custom theme colors", async () => {
    await saveReadingSettings({ ...DEFAULT_READING_SETTINGS, bgTheme: "custom", customBg: "#111111", customFg: "#eeeeee" });
    expect(api.setSetting).toHaveBeenCalledWith("reading.customBg", "#111111");
    expect(api.setSetting).toHaveBeenCalledWith("reading.customFg", "#eeeeee");
    expect(api.setSetting).toHaveBeenCalledWith("reading.bgTheme", "custom");
  });
});
