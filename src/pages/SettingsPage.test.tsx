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
vi.mock("../services/eyeCare", () => ({
  loadEyeCare: vi.fn().mockResolvedValue({ enabled: false, start: "22:00", end: "06:00" }),
  saveEyeCare: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/readingSettings", () => ({
  loadReadingSettings: vi.fn().mockResolvedValue({ customBg: "#f5e9d0", customFg: "#2b2b2b" }),
  saveReadingSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/api", () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

describe("SettingsPage", () => {
  it("renders scheme selector and switches scheme", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("Sora 青")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Koharu 樱/ }));
    expect(themeMod.setTheme).toHaveBeenCalledWith({ scheme: "koharu", mode: "light" });
  });

  it("shows a 书源管理 entry that opens the source manager page", async () => {
    const onOpen = vi.fn();
    render(<SettingsPage onOpenSourceManager={onOpen} />);
    expect(await screen.findByText(/书源管理/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /打开/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("toggles 护眼定时 and shows time inputs", async () => {
    render(<SettingsPage />);
    await screen.findByText(/护眼定时/);
    // 默认关：无时间输入
    expect(screen.queryByLabelText("护眼开始时间")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "开" }));
    // 开启后显示时间输入
    expect(screen.getByLabelText("护眼开始时间")).toBeInTheDocument();
    expect(screen.getByLabelText("护眼结束时间")).toBeInTheDocument();
  });

  it("applies custom theme colors", async () => {
    const readingSettings = await import("../services/readingSettings");
    render(<SettingsPage />);
    await screen.findByText(/自定义主题/);
    await userEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(readingSettings.saveReadingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ bgTheme: "custom", customBg: "#f5e9d0", customFg: "#2b2b2b" }),
    );
  });
});
