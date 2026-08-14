import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookSourceManager from "./BookSourceManager";
import * as api from "../services/api";
import * as imp from "../services/bookSourceImport";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  deleteBookSource: vi.fn(),
  setBookSourceEnabled: vi.fn(),
  addBookSource: vi.fn(),
}));
vi.mock("../services/bookSourceImport", () => ({
  importBookSourceFromUrl: vi.fn(),
  importBookSourceFromFile: vi.fn(),
  commitBookSource: vi.fn(),
  sourceUsesJs: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue("C:/fake/source.json"),
}));

const sources = [
  { id: 1, name: "示例书源", url: "https://ex.com", json: "{}", enabled: true, last_used_at: null },
];

const groupedSources = [
  { id: 1, name: "番茄", url: "https://a.com", json: JSON.stringify({ bookSourceGroup: "r" }), enabled: true, last_used_at: null },
  { id: 2, name: "可乐", url: "https://b.com", json: JSON.stringify({ bookSourceGroup: "r" }), enabled: true, last_used_at: null },
  { id: 3, name: "同人书源", url: "https://c.com", json: JSON.stringify({ bookSourceGroup: "同人" }), enabled: true, last_used_at: null },
  { id: 4, name: "无组", url: "https://d.com", json: "{}", enabled: true, last_used_at: null },
];

describe("BookSourceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sources with enable toggle", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(sources);
    render(<BookSourceManager />);
    expect(await screen.findByText("示例书源")).toBeInTheDocument();
  });

  it("calls onDebug with the source when 调试 is clicked", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(sources);
    const onDebug = vi.fn();
    render(<BookSourceManager onDebug={onDebug} />);
    await screen.findByText("示例书源");
    await userEvent.click(screen.getByRole("button", { name: "调试" }));
    expect(onDebug).toHaveBeenCalledWith(1, "示例书源");
  });

  it("imports a source from URL", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [{ bookSourceName: "网络书源", bookSourceUrl: "https://net.com" }],
    });
    vi.mocked(imp.commitBookSource).mockResolvedValue(9);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/source.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(imp.importBookSourceFromUrl).toHaveBeenCalledWith("https://example.com/source.json"));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalled());
  });

  it("skips single source that already exists", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "已有", url: "https://net.com", json: "{}", enabled: true, last_used_at: null },
    ]);
    vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [{ bookSourceName: "网络书源", bookSourceUrl: "https://net.com" }],
    });
    render(<BookSourceManager />);
    await screen.findByText("已有");
    await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/source.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(screen.getByText(/书源已存在，跳过/)).toBeInTheDocument());
    expect(imp.commitBookSource).not.toHaveBeenCalled();
  });

  it("imports a source from local file", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
    vi.mocked(imp.importBookSourceFromFile).mockResolvedValue({
      bookSources: [{ bookSourceName: "本地书源", bookSourceUrl: "https://local.com" }],
    });
    vi.mocked(imp.commitBookSource).mockResolvedValue(10);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.click(screen.getByRole("button", { name: /从文件导入/ }));
    await waitFor(() => expect(imp.importBookSourceFromFile).toHaveBeenCalledWith("C:/fake/source.json"));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalled());
  });

  it("aborts importing a @js: source when user cancels the confirm", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [{ bookSourceName: "JS书源", bookSourceUrl: "https://js.com", searchUrl: "@js:var a=1;" }],
    });
    vi.mocked(imp.sourceUsesJs).mockReturnValue(true);
    vi.mocked(imp.commitBookSource).mockResolvedValue(11);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://js.com/src.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(imp.importBookSourceFromUrl).toHaveBeenCalledWith("https://js.com/src.json"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(imp.commitBookSource).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("imports a @js: source after user confirms", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [{ bookSourceName: "JS书源", bookSourceUrl: "https://js.com", searchUrl: "@js:var a=1;" }],
    });
    vi.mocked(imp.sourceUsesJs).mockReturnValue(true);
    vi.mocked(imp.commitBookSource).mockResolvedValue(11);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://js.com/src.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalled());
    confirmSpy.mockRestore();
  });

  it("shows confirm list and imports selected collection sources", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [
        { bookSourceName: "A源", bookSourceUrl: "https://a.com" },
        { bookSourceName: "B源", bookSourceUrl: "https://b.com" },
      ],
    });
    vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
    vi.mocked(imp.commitBookSource).mockResolvedValue(1);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/collection.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(screen.getByText("A源")).toBeInTheDocument());
    expect(screen.getByText("B源")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /B源/ }));
    await userEvent.click(screen.getByRole("button", { name: /导入选中/ }));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalledTimes(1));
    expect(imp.commitBookSource).toHaveBeenCalledWith(expect.objectContaining({ bookSourceName: "A源" }));
  });

  it("shows existing sources in confirm list but leaves them unchecked by default", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "A源", url: "https://a.com", json: "{}", enabled: true, last_used_at: null },
    ]);
    vi.mocked(imp.importBookSourceFromFile).mockResolvedValue({
      bookSources: [
        { bookSourceName: "A源", bookSourceUrl: "https://a.com" },
        { bookSourceName: "B源", bookSourceUrl: "https://b.com" },
      ],
    });
    vi.mocked(imp.sourceUsesJs).mockReturnValue(false);
    vi.mocked(imp.commitBookSource).mockResolvedValue(2);
    render(<BookSourceManager />);
    await screen.findByText("A源");
    await userEvent.click(screen.getByRole("button", { name: /从文件导入/ }));
    await waitFor(() => expect(screen.getByText("B源")).toBeInTheDocument());
    // 已存在的 A源 默认不勾选，显示「已有」标记；新书源 B源 默认勾选
    expect(screen.getByRole("checkbox", { name: "A源" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B源" })).toBeChecked();
    expect(screen.getByText("已有")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /导入选中/ }));
    await waitFor(() => expect(imp.commitBookSource).toHaveBeenCalledTimes(1));
    expect(imp.commitBookSource).toHaveBeenCalledWith(expect.objectContaining({ bookSourceName: "B源" }));
  });

  it("marks JS sources in the confirm list", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(imp.importBookSourceFromUrl).mockResolvedValue({
      bookSources: [
        { bookSourceName: "J源", bookSourceUrl: "https://j.com", searchUrl: "@js:var a=1;" },
        { bookSourceName: "K源", bookSourceUrl: "https://k.com" },
      ],
    });
    vi.mocked(imp.sourceUsesJs).mockImplementation((bs) => bs?.bookSourceName === "J源");
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    await userEvent.type(screen.getByLabelText("书源网址"), "https://example.com/c.json");
    await userEvent.click(screen.getByRole("button", { name: /从网址导入/ }));
    await waitFor(() => expect(screen.getByText(/含脚本/)).toBeInTheDocument());
  });

  it("groups sources by bookSourceGroup with 未分组 fallback", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
    render(<BookSourceManager />);
    expect(await screen.findByText("r")).toBeInTheDocument();
    expect(screen.getByText("同人")).toBeInTheDocument();
    expect(screen.getByText("未分组")).toBeInTheDocument();
    expect(screen.getByText("番茄")).toBeInTheDocument();
    expect(screen.getByText("无组")).toBeInTheDocument();
  });

  it("collapses a group on header click and hides its sources", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
    render(<BookSourceManager />);
    await screen.findByText("r");
    await userEvent.click(screen.getByText("r"));
    expect(screen.queryByText("番茄")).not.toBeInTheDocument();
    expect(screen.getByText("同人")).toBeInTheDocument();
    await userEvent.click(screen.getByText("r"));
    expect(screen.getByText("番茄")).toBeInTheDocument();
  });

  it("filters sources by name or url via search box", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue(groupedSources as any);
    render(<BookSourceManager />);
    await screen.findByText("番茄");
    await userEvent.type(screen.getByLabelText("搜索书源"), "可乐");
    expect(screen.getByText("可乐")).toBeInTheDocument();
    expect(screen.queryByText("番茄")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("搜索书源"));
    await userEvent.type(screen.getByLabelText("搜索书源"), "https://c.com");
    expect(screen.getByText("同人")).toBeInTheDocument();
  });
});
