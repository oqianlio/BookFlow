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
  copyFontFile: vi.fn().mockResolvedValue({ name: "MyFont", file: "MyFont_123.ttf" }),
  listFontFiles: vi.fn().mockResolvedValue([]),
  cacheSummary: vi.fn().mockResolvedValue({ book_count: 3, chapter_count: 120, total_bytes: 5242880 }),
  clearAllCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/fontFiles", () => ({
  injectFontFaces: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue("C:/fonts/myfont.ttf"),
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

  it("imports a font file and sets it as the reading font", async () => {
    const readingSettings = await import("../services/readingSettings");
    const api = await import("../services/api");
    render(<SettingsPage />);
    await screen.findByText(/字体文件/);
    await userEvent.click(screen.getByRole("button", { name: "导入字体" }));
    expect(api.copyFontFile).toHaveBeenCalledWith("C:/fonts/myfont.ttf");
    expect(readingSettings.saveReadingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ fontFamily: "MyFont" }),
    );
  });

  it("shows cache summary and clears all cache with confirmation", async () => {
    const api = await import("../services/api");
    render(<SettingsPage />);
    expect(await screen.findByText(/已缓存 120 章 \/ 3 本书 \/ 5.0 MB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "清除全部缓存" }));
    expect(screen.getByText(/将清除全部 120 章离线缓存/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(api.clearAllCache).toHaveBeenCalled();
  });
});
