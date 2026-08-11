import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./SettingsPage";
import * as themeMod from "../components/theme";

vi.mock("../components/theme", () => ({
  SCHEMES: ["sora", "koharu", "yuuka", "phoebe", "wh"],
  SCHEME_NAMES: { sora: "Sora 青", koharu: "Koharu 樱", yuuka: "Yuuka 紫", phoebe: "Phoebe 橙", wh: "WH 灰" },
  getTheme: vi.fn().mockReturnValue({ scheme: "sora", mode: "light" }),
  setTheme: vi.fn().mockResolvedValue(undefined),
  initTheme: vi.fn().mockResolvedValue(undefined),
  getFontSize: vi.fn().mockReturnValue(18),
  setFontSize: vi.fn().mockResolvedValue(undefined),
  getTtsRate: vi.fn().mockResolvedValue(1),
  setTtsRate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/TtsBar", () => ({ getTtsRate: vi.fn().mockResolvedValue(1), setTtsRate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/BookSourceManager", () => ({ default: () => null }));

describe("SettingsPage", () => {
  it("renders scheme selector and switches scheme", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("Sora 青")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Koharu 樱/ }));
    expect(themeMod.setTheme).toHaveBeenCalledWith({ scheme: "koharu", mode: "light" });
  });
});
