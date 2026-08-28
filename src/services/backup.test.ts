import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportBackupData, importBackupData, BACKUP_VERSION } from "./backup";
import * as api from "./api";
import * as readingSettings from "./readingSettings";
import * as theme from "../components/theme";

vi.mock("./api", () => ({
  listBookSources: vi.fn(),
  addBookSource: vi.fn().mockResolvedValue(1),
  updateBookSource: vi.fn().mockResolvedValue(undefined),
  getSourceByUrl: vi.fn().mockResolvedValue(null),
  listShelfSourceBooks: vi.fn(),
  addShelfSourceBook: vi.fn().mockResolvedValue(1),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  saveBookSourceProgress: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./readingSettings", () => ({
  loadReadingSettings: vi.fn().mockResolvedValue({ fontSizePx: 18, lineHeight: 1.8, fontFamily: "默认" }),
  saveReadingSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/theme", () => ({
  getTheme: vi.fn().mockReturnValue({ scheme: "sora", mode: "light" }),
  setTheme: vi.fn().mockResolvedValue(undefined),
  SCHEMES: ["sora", "koharu", "yuuka", "phoebe", "wh"],
}));

const srcRow = (id: number, name: string, url: string) => ({
  id, name, url, json: JSON.stringify({ bookSourceUrl: url, bookSourceName: name }), enabled: true, last_used_at: null,
});
const shelfBook = (sourceId: number, bookUrl: string, title: string): api.ShelfSourceBook => ({
  id: 1, source_id: sourceId, book_url: bookUrl, title, author: "作者", cover_url: "c.jpg",
  source_name: "源A", added_at: 1, last_opened_at: null,
});

describe("backup", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("exports book sources, shelf books, progress and settings", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([srcRow(1, "源A", "https://a.com")]);
    vi.mocked(api.listShelfSourceBooks).mockResolvedValue([shelfBook(1, "https://a.com/b1", "书一")]);
    vi.mocked(api.getBookSourceProgress).mockResolvedValue({
      source_id: 1, book_url: "https://a.com/b1", title: "书一",
      chapter_index: 3, chapter_url: "https://a.com/c3", chapter_name: "第三章", percent: 0,
      updated_at: 1,
    });
    vi.mocked(api.getSetting).mockResolvedValueOnce('{"enabled":false}');
    const d = await exportBackupData();
    expect(d.version).toBe(BACKUP_VERSION);
    expect(d.bookSources).toHaveLength(1);
    expect(d.shelfSourceBooks).toHaveLength(1);
    expect(d.sourceProgress).toHaveLength(1);
    expect(d.sourceProgress[0].chapterName).toBe("第三章");
    expect(d.settings.eyeCare).toBe('{"enabled":false}');
    expect(d.theme).toEqual({ scheme: "sora", mode: "light" });
  });

  it("imports backup: adds sources, shelf books, progress and settings", async () => {
    vi.mocked(api.getSourceByUrl).mockResolvedValue(null);
    const text = JSON.stringify({
      version: BACKUP_VERSION, exportedAt: 1,
      bookSources: [{ name: "源A", url: "https://a.com", json: "{}", enabled: true }],
      shelfSourceBooks: [shelfBook(1, "https://a.com/b1", "书一")],
      sourceProgress: [{ sourceId: 1, bookUrl: "https://a.com/b1", title: "书一", chapterIndex: 3, chapterUrl: "https://a.com/c3", chapterName: "第三章" }],
      settings: { eyeCare: '{"enabled":true}' },
      readingSettings: { fontSizePx: 20, lineHeight: 1.7, fontFamily: "默认" },
      theme: { scheme: "yuuka", mode: "dark" },
    });
    const sum = await importBackupData(text);
    expect(sum).toEqual({ sources: 1, shelf: 1, progress: 1, failed: { sources: 0, shelf: 0, progress: 0, settings: 0 } });
    expect(api.addBookSource).toHaveBeenCalledWith("源A", "https://a.com", "{}");
    expect(api.addShelfSourceBook).toHaveBeenCalledWith(expect.objectContaining({ bookUrl: "https://a.com/b1" }));
    expect(api.saveBookSourceProgress).toHaveBeenCalledWith(expect.objectContaining({ chapterName: "第三章" }));
    expect(api.setSetting).toHaveBeenCalledWith("eyeCare", '{"enabled":true}');
    expect(readingSettings.saveReadingSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSizePx: 20 }));
    expect(theme.setTheme).toHaveBeenCalledWith({ scheme: "yuuka", mode: "dark" });
  });

  it("updates existing source by url instead of duplicating", async () => {
    vi.mocked(api.getSourceByUrl).mockResolvedValue(srcRow(9, "旧名", "https://a.com"));
    const text = JSON.stringify({
      version: BACKUP_VERSION, exportedAt: 1,
      bookSources: [{ name: "新名", url: "https://a.com", json: "{\"x\":1}", enabled: true }],
      shelfSourceBooks: [], sourceProgress: [], settings: {},
      readingSettings: {}, theme: { scheme: "sora", mode: "light" },
    });
    await importBackupData(text);
    expect(api.addBookSource).not.toHaveBeenCalled();
    expect(api.updateBookSource).toHaveBeenCalledWith(9, "旧名", "https://a.com", '{"x":1}');
  });

  it("rejects wrong version and malformed files", async () => {
    await expect(importBackupData("not json")).rejects.toThrow();
    await expect(importBackupData(JSON.stringify({ version: 99, bookSources: [] }))).rejects.toThrow(/版本不兼容/);
    await expect(importBackupData(JSON.stringify({ version: BACKUP_VERSION }))).rejects.toThrow(/格式不正确/);
  });
});
