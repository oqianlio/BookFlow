import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTheme, getFontSize, setFontSize } from "./theme";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("applies dark theme attribute", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("roundtrips font size", async () => {
    (api.setSetting as any).mockResolvedValue(undefined);
    (api.getSetting as any).mockResolvedValue("18");
    await setFontSize(18);
    expect(getFontSize()).toBe(18);
  });
});
