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
      name: "网络书源", url: "https://net.com", bookSource: { bookSourceName: "网络书源", bookSourceUrl: "https://net.com" },
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
      name: "本地书源", url: "https://local.com", bookSource: { bookSourceName: "本地书源", bookSourceUrl: "https://local.com" },
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
      name: "JS书源", url: "https://js.com",
      bookSource: { bookSourceName: "JS书源", bookSourceUrl: "https://js.com", searchUrl: "@js:var a=1;" },
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
      name: "JS书源", url: "https://js.com",
      bookSource: { bookSourceName: "JS书源", bookSourceUrl: "https://js.com", searchUrl: "@js:var a=1;" },
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
});
