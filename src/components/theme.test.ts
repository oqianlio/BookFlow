import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTheme, getTheme, parseTheme, getFontSize, setFontSize } from "./theme";
import * as api from "../services/api";

vi.mock("../services/api", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

beforeEach(() => {
  document.documentElement.removeAttribute("data-scheme");
  document.documentElement.removeAttribute("data-mode");
});

describe("theme matrix", () => {
  it("parses persisted value with scheme", () => {
    expect(parseTheme("koharu:dark")).toEqual({ scheme: "koharu", mode: "dark" });
  });
  it("parses legacy value as sora default", () => {
    expect(parseTheme("dark")).toEqual({ scheme: "sora", mode: "dark" });
    expect(parseTheme("light")).toEqual({ scheme: "sora", mode: "light" });
  });
  it("parses null/empty to sora light", () => {
    expect(parseTheme(null)).toEqual({ scheme: "sora", mode: "light" });
    expect(parseTheme("")).toEqual({ scheme: "sora", mode: "light" });
  });
  it("applies data-scheme and data-mode attributes", () => {
    applyTheme({ scheme: "yuuka", mode: "dark" });
    expect(document.documentElement.getAttribute("data-scheme")).toBe("yuuka");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });
  it("roundtrips getTheme from attributes", () => {
    applyTheme({ scheme: "wh", mode: "light" });
    expect(getTheme()).toEqual({ scheme: "wh", mode: "light" });
  });
  it("roundtrips font size", async () => {
    (api.setSetting as any).mockResolvedValue(undefined);
    (api.getSetting as any).mockResolvedValue("18");
    await setFontSize(18);
    expect(getFontSize()).toBe(18);
  });
});
