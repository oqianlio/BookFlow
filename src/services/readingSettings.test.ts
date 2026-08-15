import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import {
  loadReadingSettings,
  saveReadingSettings,
  BG_THEMES,
  DEFAULT_READING_SETTINGS,
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
    await saveReadingSettings({ pageMode: "slide", fontSizePx: 21, lineHeight: 2.0, bgTheme: "night" });
    expect(api.setSetting).toHaveBeenCalledWith("reading.pageMode", "slide");
    expect(api.setSetting).toHaveBeenCalledWith("reading.fontSizePx", "21");
    expect(api.setSetting).toHaveBeenCalledWith("reading.lineHeight", "2");
    expect(api.setSetting).toHaveBeenCalledWith("reading.bgTheme", "night");
  });

  it("exposes four preset background themes", () => {
    expect(BG_THEMES.map((t) => t.id)).toEqual(["paper", "beige", "green", "night"]);
  });
});
