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

  it("skips existing URLs when importing collection", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /导入选中/ }));
    await waitFor(() => expect(screen.getByText(/成功导入 1 个，跳过 1 个/)).toBeInTheDocument());
    expect(imp.commitBookSource).toHaveBeenCalledTimes(1);
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
});
