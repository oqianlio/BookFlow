import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReaderPage from "./ReaderPage";
import { ErrorProvider } from "../components/ErrorDialog";
import * as api from "../services/api";
import { clearTocCache } from "../services/sourceToc";
import { clearSessionChapterCache } from "../services/chapterSessionCache";

vi.mock("../readers/EpubReader", () => ({ default: () => null }));
vi.mock("../readers/PdfReader", () => ({ default: () => null }));
vi.mock("../readers/MdReader", () => ({ default: () => null }));
vi.mock("../readers/TxtReader", () => ({ default: () => null }));

vi.mock("../components/SwitchSourcePanel", () => ({
  default: (props: any) => (
    <div data-testid="switch-panel">
      <span data-testid="switch-title">{props.title}</span>
      <span data-testid="switch-author">{props.author}</span>
      <button onClick={() => props.onPick({ title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://c.com/b.html", sourceId: 3, sourceName: "源C" })}>
        pick-c
      </button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}));

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  saveBookSourceProgress: vi.fn().mockResolvedValue(undefined),
  openLoginWindow: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  listShelfSourceBooks: vi.fn().mockResolvedValue([]),
  addShelfSourceBook: vi.fn().mockResolvedValue(1),
  removeShelfSourceBook: vi.fn().mockResolvedValue(undefined),
  getCachedChapter: vi.fn().mockResolvedValue(null),
  saveCachedChapter: vi.fn().mockResolvedValue(undefined),
  recordRead: vi.fn().mockResolvedValue(undefined),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleContent: { content: "#content", nextContentUrl: "a#next@href" },
});

const ch1 = `<html><body><div id="content"><p>第一章正文内容。</p></div><a id="next" href="/c/2.html">下一章</a></body></html>`;
const ch2 = `<html><body><div id="content"><p>第二章正文内容。</p></div><a id="next" href="/c/3.html">下一章</a></body></html>`;
const ch3 = `<html><body><div id="content"><p>第三章正文内容。</p></div><a id="next" href="/c/4.html">下一章</a></body></html>`;

const tocSourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href" },
  ruleContent: { content: "#content", nextContentUrl: "a#next@href" },
});
const tocHtml = `<html><body><h1>三体</h1><ol>
  <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;

beforeEach(() => { vi.clearAllMocks(); clearTocCache(); clearSessionChapterCache(); });

function renderReader() {
  return render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第一章" }} onBack={() => {}} />);
}

describe("ReaderPage (source)", () => {
  it("fetches and renders chapter content", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
  });

  it("上一章 pops the URL stack and loads the real previous chapter", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();

    const nextBtn = screen.getByRole("button", { name: "下一章" });
    const prevBtn = screen.getByRole("button", { name: "上一章" });
    expect(prevBtn).toBeDisabled();

    fireEvent.click(nextBtn);
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第 2 章");
    expect(prevBtn).toBeEnabled();

    fireEvent.click(prevBtn);
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第 1 章");
    expect(prevBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一章" })).toBeEnabled();
  });

  it("applies source purify replace rules to chapter content", async () => {
    const src = JSON.parse(sourceJson);
    src.purify = ["##广告##（净）##"];
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content"><p>净化正文。广告</p></div></body></html>`,
    );
    renderReader();
    expect(await screen.findByText("净化正文。（净）")).toBeInTheDocument();
    expect(screen.queryByText(/广告/)).not.toBeInTheDocument();
  });

  it("renders source content inside the paginated reader (reader-slice-wrap)", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    const { container } = renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    const wrap = container.querySelector(".reader-slice-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap?.textContent).toContain("第一章正文内容。");
    expect(container.querySelector(".reader-slice-nav span")?.textContent).toBe("1 / 1");
  });

  it("shows the error dialog and retry button when a chapter fails, and recovers on retry", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    // 目录预取（bookUrl）成功；章节第一次失败、重试成功
    let chapterCalls = 0;
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") {
        return `<html><body><h1>三体</h1></body></html>`;
      }
      chapterCalls += 1;
      if (chapterCalls === 1) throw new Error("网络错误");
      return ch1;
    });
    render(<ErrorProvider><ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第一章" }} onBack={() => {}} /></ErrorProvider>);
    expect(await screen.findByText("出错了")).toBeInTheDocument();
    expect(screen.getByText(/网络错误/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
  });

  it("does not override an explicit chapter choice with saved progress", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    vi.mocked(api.getBookSourceProgress).mockResolvedValue({
      source_id: 1, book_url: "https://ex.com/book/1.html", title: "三体",
      chapter_index: 99, chapter_url: "https://ex.com/c/99.html", chapter_name: "第 99 章",
      percent: 0, updated_at: 0,
    });
    renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(screen.queryByText("第 99 章")).not.toBeInTheDocument();
  });

  it("resumes from saved progress when entering with -1", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch2);
    vi.mocked(api.getBookSourceProgress).mockResolvedValue({
      source_id: 1, book_url: "https://ex.com/book/1.html", title: "三体",
      chapter_index: 1, chapter_url: "https://ex.com/c/2.html", chapter_name: "第二章",
      percent: 0, updated_at: 0,
    });
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: -1, chapterUrl: "", chapterName: "" }} onBack={() => {}} />);
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("第二章")).toBeInTheDocument();
  });

  it("shows an empty state when resuming with no saved progress", async () => {
    vi.mocked(api.getBookSourceProgress).mockResolvedValue(null);
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: -1, chapterUrl: "", chapterName: "" }} onBack={() => {}} />);
    expect(await screen.findByText("请从目录选择章节")).toBeInTheDocument();
  });

  it("shows 登录 button on the empty-state path when the source has loginUrl", async () => {
    const src = JSON.parse(sourceJson);
    src.loginUrl = "https://ex.com/login";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.getBookSourceProgress).mockResolvedValue(null);
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: -1, chapterUrl: "", chapterName: "" }} onBack={() => {}} />);
    expect(await screen.findByText("请从目录选择章节")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("开始阅读无进度时自动加载第一章（不显示请从目录选择章节）", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: tocSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.getBookSourceProgress).mockResolvedValue(null);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/book/1.html") return tocHtml;
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: -1, chapterUrl: "", chapterName: "" }} onBack={() => {}} />);
    // 目录加载后自动进入第一章正文
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.queryByText("请从目录选择章节")).not.toBeInTheDocument();
  });

  it("passes the source hostname as cookieJar to chapter httpGet", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    renderReader();
    await screen.findByText("第一章正文内容。");
    const calls = vi.mocked(api.httpGet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[6]).toBe("ex.com");
  });

  it("renders manga viewer for image chapters", async () => {
    const src = JSON.parse(sourceJson);
    src.ruleContent.content = "@css:.content@html";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div class="content"><img src="/img/1.jpg"><img src="/img/2.jpg"></div></body></html>`,
    );
    const { container } = render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/b/1.html", bookTitle: "漫画", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第1话" }} onBack={() => {}} />);
    expect(await screen.findByAltText("图片 2")).toBeInTheDocument();
    expect(container.querySelector(".manga-viewer")).not.toBeNull();
    const imgs = container.querySelectorAll(".manga-viewer img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("https://ex.com/img/1.jpg");
  });

  it("renders text content for a chapter with a single inline image", async () => {
    const src = JSON.parse(sourceJson);
    src.ruleContent.content = "@css:.content@html";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div class="content"><p>正文段落，附带一张装饰图。</p><img src="/deco/cover.jpg"></div></body></html>`,
    );
    const { container } = render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第一章" }} onBack={() => {}} />);
    expect(await screen.findByText("正文段落，附带一张装饰图。")).toBeInTheDocument();
    expect(container.querySelector(".manga-viewer")).toBeNull();
  });

  it("shows the empty state for an image chapter with no extractable urls", async () => {
    const src = JSON.parse(sourceJson);
    src.ruleContent.content = "@css:.content@html";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div class="content"><img src=""><img data-lazy="/lazy/1.jpg"></div></body></html>`,
    );
    const { container } = render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/b/1.html", bookTitle: "漫画", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第1话" }} onBack={() => {}} />);
    expect(await screen.findByText("无图片")).toBeInTheDocument();
    expect(container.querySelector(".md-reader")).toBeNull();
  });
});

describe("ReaderPage (source) reading settings", () => {
  async function renderWithSettings(saved: Record<string, string> = {}) {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    vi.mocked(api.getSetting).mockImplementation(async (k: string) => saved[k] ?? null);
    const utils = renderReader();
    await screen.findByText("第一章正文内容。");
    return utils;
  }

  it("opens the settings panel from the toolbar", async () => {
    const { container } = await renderWithSettings();
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    expect(screen.getByText("翻页模式")).toBeInTheDocument();
    expect(container.querySelector(".reader-settings-panel")).not.toBeNull();
    // 面板关闭
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    expect(container.querySelector(".reader-settings-panel")).toBeNull();
  });

  it("switches page mode and re-renders PaginatedReader with the new mode", async () => {
    const { container } = await renderWithSettings();
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    const slideBtn = screen.getByRole("button", { name: "滑动" });
    await userEvent.click(slideBtn);
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.className).toContain("slide");
    // 持久化
    await waitFor(() =>
      expect(api.setSetting).toHaveBeenCalledWith("reading.pageMode", "slide"),
    );
  });

  it("changes font size and line height sliders", async () => {
    await renderWithSettings();
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    const font = screen.getByLabelText("字号") as HTMLInputElement;
    // 用 fireEvent.change 设置值
    fireEvent.change(font, { target: { value: "22" } });
    expect(screen.getByText(/字号 22px/)).toBeInTheDocument();
    const line = screen.getByLabelText("行距") as HTMLInputElement;
    fireEvent.change(line, { target: { value: "2.2" } });
    expect(screen.getByText(/行距 2\.2/)).toBeInTheDocument();
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.fontSizePx", "22"));
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.lineHeight", "2.2"));
  });

  it("applies the selected background theme to the reader main", async () => {
    const { container } = await renderWithSettings();
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    await userEvent.click(screen.getByRole("button", { name: "夜间" }));
    const main = container.querySelector(".reader-main") as HTMLElement;
    expect(main.style.background).toBe("rgb(20, 19, 19)");
    expect(main.getAttribute("data-bg-theme")).toBe("night");
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.bgTheme", "night"));
  });

  it("restores saved settings on mount", async () => {
    const { container } = await renderWithSettings({
      "reading.pageMode": "cover",
      "reading.fontSizePx": "21",
      "reading.lineHeight": "2",
      "reading.bgTheme": "beige",
    });
    const main = container.querySelector(".reader-main") as HTMLElement;
    expect(main.getAttribute("data-bg-theme")).toBe("beige");
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    expect(slice.getAttribute("style")).toContain("2");
  });

  it("adjusts typography controls and passes them to PaginatedReader", async () => {
    const { container } = await renderWithSettings();
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    fireEvent.change(screen.getByLabelText("字间距"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("段间距"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("首行缩进"), { target: { value: "1" } });
    await userEvent.click(screen.getByRole("button", { name: "加粗" }));
    await userEvent.click(screen.getByRole("button", { name: "楷体" }));
    const slice = container.querySelector(".reader-page-slice") as HTMLElement;
    await waitFor(() => {
      expect(slice.style.letterSpacing).toBe("2px");
      expect(slice.style.fontWeight).toBe("700");
    });
    expect(slice.style.fontFamily).toContain("KaiTi");
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.bold", "1"));
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.fontFamily", "kai"));
  });

  it("switches to traditional and converts rendered content", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content"><p>开门见山说时间</p></div></body></html>`,
    );
    renderReader();
    await screen.findByText("开门见山说时间");
    await userEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    await userEvent.click(screen.getByRole("button", { name: "繁体" }));
    expect(await screen.findByText("開門見山說時間")).toBeInTheDocument();
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("reading.conversion", "trad"));
  });

  it("applies custom theme background when bgTheme is custom", async () => {
    const { container } = await renderWithSettings({
      "reading.bgTheme": "custom",
      "reading.customBg": "#123456",
      "reading.customFg": "#abcdef",
    });
    const main = container.querySelector(".reader-main") as HTMLElement;
    expect(main.style.background).toBe("rgb(18, 52, 86)");
    expect(main.getAttribute("data-bg-theme")).toBe("custom");
    expect(main.style.getPropertyValue("--read-fg")).toBe("#abcdef");
  });
});

describe("ReaderPage (source) toc panel", () => {
  async function renderWithToc() {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: tocSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") return tocHtml;
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const utils = renderReader();
    await screen.findByText("第一章正文内容。");
    return utils;
  }

  it("opens the toc panel and lists chapters with current highlighted", async () => {
    const { container } = await renderWithToc();
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(container.querySelector(".reader-toc-panel")).not.toBeNull();
    const items = container.querySelectorAll(".toc-item");
    expect(items.length).toBe(2);
    expect(items[0].className).toContain("active");
    expect(items[0].textContent).toBe("第一章");
    // 关闭面板
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(container.querySelector(".reader-toc-panel")).toBeNull();
  });

  it("jumps to a chapter from the toc", async () => {
    const { container } = await renderWithToc();
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    const items = container.querySelectorAll(".toc-item");
    await userEvent.click(items[1] as HTMLElement);
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(container.querySelector(".reader-toc-panel")).toBeNull(); // 面板已关闭
    expect(screen.getByText("第二章")).toBeInTheDocument();
  });

  it("shows retry on toc failure and recovers", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: tocSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/c/1.html") return ch1;
      throw new Error("目录网络错误");
    });
    renderReader();
    await screen.findByText("第一章正文内容。");
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(await screen.findByText("目录加载失败")).toBeInTheDocument();
    // 恢复后重试成功
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") return tocHtml;
      if (url === "https://ex.com/c/1.html") return ch1;
      return ch2;
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("第一章")).toBeInTheDocument();
    expect(screen.getByText("第二章")).toBeInTheDocument();
  });
});

describe("ReaderPage (source) shelf toggle", () => {
  it("adds the book to the shelf from the reader toolbar", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    renderReader();
    await screen.findByText("第一章正文内容。");
    const addBtn = screen.getByRole("button", { name: "加入书架" });
    await userEvent.click(addBtn);
    expect(api.addShelfSourceBook).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 1, bookUrl: "https://ex.com/book/1.html", title: "三体",
    }));
    expect(await screen.findByRole("button", { name: "已在书架" })).toBeInTheDocument();
  });

  it("shows 已在书架 when already on the shelf and removes on click", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    vi.mocked(api.listShelfSourceBooks).mockResolvedValue([
      { id: 7, source_id: 1, source_name: "示例", book_url: "https://ex.com/book/1.html", title: "三体", author: null, cover_url: null, added_at: 1, last_opened_at: null },
    ]);
    renderReader();
    await screen.findByText("第一章正文内容。");
    const btn = screen.getByRole("button", { name: "已在书架" });
    await userEvent.click(btn);
    expect(api.removeShelfSourceBook).toHaveBeenCalledWith(7);
    expect(await screen.findByRole("button", { name: "加入书架" })).toBeInTheDocument();
  });
});

describe("ReaderPage (source) switch source", () => {
  const onSwitchSource = vi.fn();

  function renderWithSwitch() {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    return render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第一章" }} onBack={() => {}} onSwitchSource={onSwitchSource} />);
  }

  it("opens the switch panel from the toolbar and calls onSwitchSource on pick", async () => {
    const { container } = renderWithSwitch();
    await screen.findByText("第一章正文内容。");
    const btn = screen.getByRole("button", { name: "换源" });
    await userEvent.click(btn);
    expect(container.querySelector('[data-testid="switch-panel"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "pick-c" }));
    expect(onSwitchSource).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 3, sourceName: "源C" }));
  });

  it("passes the book author to the switch panel for a precise same-book search", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: tocSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/book/1.html") {
        return `<html><body><h1>三体</h1><div class="author">刘慈欣</div><ol><li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;
      }
      return ch1;
    });
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第一章" }} onBack={() => {}} onSwitchSource={onSwitchSource} />);
    await screen.findByText("第一章正文内容。");
    // 等目录解析出作者后打开换源面板
    await userEvent.click(screen.getByRole("button", { name: "换源" }));
    await waitFor(() => expect(screen.getByTestId("switch-author")).toHaveTextContent("刘慈欣"));
    expect(screen.getByTestId("switch-title")).toHaveTextContent("三体");
  });
});

describe("ReaderPage (source) chapter cache", () => {
  it("renders from cache without fetching the chapter online", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.getCachedChapter).mockResolvedValue("<p>缓存正文内容。</p>");
    renderReader();
    expect(await screen.findByText("缓存正文内容。")).toBeInTheDocument();
    // 章节 URL 未被请求（目录预取的 bookUrl 请求允许存在）
    const chapterCalls = vi.mocked(api.httpGet).mock.calls.filter((c) => String(c[0]).includes("/c/1.html"));
    expect(chapterCalls.length).toBe(0);
  });

  it("caches fetched content for offline reuse", async () => {
    vi.mocked(api.getCachedChapter).mockResolvedValue(null);
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    renderReader();
    await screen.findByText("第一章正文内容。");
    await waitFor(() =>
      expect(api.saveCachedChapter).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: 1,
        bookUrl: "https://ex.com/book/1.html",
        chapterUrl: "https://ex.com/c/1.html",
        content: expect.stringContaining("第一章正文内容。"),
      })),
    );
  });

  it("reopens a recently read chapter instantly from the session cache without refetching", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const { unmount } = renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    const callsBefore = vi.mocked(api.httpGet).mock.calls.filter((c) => String(c[0]).includes("/c/1.html")).length;
    // 退出阅读页再重新打开（组件卸载 → 重新挂载）
    unmount();
    const reopened = renderReader();
    // 会话缓存直接渲染：内容即刻显示，无「加载中…」
    await waitFor(() => expect(reopened.container.textContent).toContain("第一章正文内容。"));
    expect(reopened.container.textContent).not.toContain("加载中…");
    // 章节 URL 未被重新请求
    const callsAfter = vi.mocked(api.httpGet).mock.calls.filter((c) => String(c[0]).includes("/c/1.html")).length;
    expect(callsAfter).toBe(callsBefore);
  });
});

describe("ReaderPage (source) reading stats", () => {
  it("reports a read session on mount", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(ch1);
    renderReader();
    await screen.findByText("第一章正文内容。");
    await waitFor(() =>
      expect(api.recordRead).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: 1, bookUrl: "https://ex.com/book/1.html", seconds: 0, incrementCount: true,
      })),
    );
  });
});

describe("ReaderPage (source) auto next chapter at page end", () => {
  // jsdom 无布局：给分页容器注入宽度，让区域点击（右 1/3）可判定
  function mockWrapRect(el: HTMLElement, width = 1200) {
    el.getBoundingClientRect = () =>
      ({
        left: 0, top: 0, right: width, bottom: 100, width, height: 100, x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  // jsdom 无 IntersectionObserver：可编程 mock（观察漫画最后一张图）
  class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];
    private cb: IntersectionObserverCallback;
    private el: Element | null = null;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      MockIntersectionObserver.instances.push(this);
    }
    observe(el: Element) { this.el = el; }
    unobserve() {}
    disconnect() {}
    trigger(intersecting: boolean) {
      if (!this.el) return;
      this.cb(
        [{ isIntersecting: intersecting, target: this.el, intersectionRatio: intersecting ? 1 : 0 } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
  }

  beforeEach(() => { MockIntersectionObserver.instances = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("auto-loads the next chapter when flipping to the end of a chapter page", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const { container } = renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    // jsdom 无布局 → 章节被切为单页；点击翻页区域 = 触达末页 → 自动进入下一章
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    fireEvent.click(wrap, { clientX: 900 });
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第 2 章");
  });

  it("auto-loads the previous chapter when flipping back past the first page", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: tocSourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/book/1.html") return tocHtml;
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const { container } = render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/book/1.html", bookTitle: "三体", chapterIndex: 1, chapterUrl: "https://ex.com/c/2.html", chapterName: "第二章" }} onBack={() => {}} />);
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    // 直接进入章节（无历史栈）：上一章按钮在目录有上一章时应可用
    expect(screen.getByRole("button", { name: "上一章" })).toBeEnabled();
    // 等目录加载完成（上一章兜底依赖 toc）
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => expect(container.querySelectorAll(".toc-item").length).toBe(2));
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    // 首页（单页章节）点击左侧 → 越过首页 → 经目录进入上一章
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    fireEvent.click(wrap, { clientX: 100 });
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第一章");
  });

  it("falls back to the toc for the next chapter when the source has no nextContentUrl", async () => {
    const src = JSON.parse(tocSourceJson);
    delete src.ruleContent.nextContentUrl;
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/book/1.html") return tocHtml;
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const { container } = renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    // 等目录加载完成（自动进入下一章依赖 toc 兜底）
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => expect(container.querySelectorAll(".toc-item").length).toBe(2));
    await userEvent.click(screen.getByRole("button", { name: "目录" }));
    // 翻到章节末页（单页章节）→ 无 nextContentUrl，从目录取下一章
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    fireEvent.click(wrap, { clientX: 900 });
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第二章");
  });

  it("prefetches the next chapter so flipping to the page end shows it seamlessly", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/c/1.html") return ch1;
      if (url === "https://ex.com/c/2.html") return ch2;
      return ch3;
    });
    const { container } = renderReader();
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    // 后台已预取下一章并完成（写入持久缓存）
    await waitFor(() =>
      expect(api.saveCachedChapter).toHaveBeenCalledWith(expect.objectContaining({ chapterUrl: "https://ex.com/c/2.html" })),
    );
    // 翻到章节末页 → 无缝显示下一章，无「加载中…」
    const wrap = container.querySelector(".reader-slice-wrap")! as HTMLElement;
    mockWrapRect(wrap);
    fireEvent.click(wrap, { clientX: 900 });
    expect(await screen.findByText("第二章正文内容。")).toBeInTheDocument();
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
  });

  it("auto-loads the next chapter when the last manga image enters the viewport", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const src = JSON.parse(sourceJson);
    src.ruleContent.content = "@css:.content@html";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://ex.com/c/1.html") {
        return `<html><body><div class="content"><img src="/img/1.jpg"><img src="/img/2.jpg"></div><a id="next" href="/c/2.html">下一话</a></body></html>`;
      }
      return `<html><body><div class="content"><img src="/img/3.jpg"><img src="/img/4.jpg"></div></body></html>`;
    });
    const { container } = render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://ex.com/b/1.html", bookTitle: "漫画", chapterIndex: 0, chapterUrl: "https://ex.com/c/1.html", chapterName: "第1话" }} onBack={() => {}} />);
    expect(await screen.findByAltText("图片 2")).toBeInTheDocument();
    // 最后一张图进入视口 → 自动进入下一话
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0));
    const obs = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
    obs.trigger(true);
    await waitFor(() => {
      const imgs = container.querySelectorAll(".manga-viewer img");
      expect(imgs.length).toBe(2);
      expect(imgs[0].getAttribute("src")).toBe("https://ex.com/img/3.jpg");
      expect(imgs[1].getAttribute("src")).toBe("https://ex.com/img/4.jpg");
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第 2 章");
  });

  it("concatenates same-chapter paginated content (36xs 6516910.html → 6516910_1.html)", async () => {
    // 分页正文：nextContentUrl 指向同章节下一页（同前缀）→ 拼接进当前章节，不当作下一章
    const paginatedJson = JSON.stringify({
      bookSourceUrl: "https://www.36xs.net", bookSourceName: "36小说网",
      ruleContent: { content: "#content", nextContentUrl: "a#next@href" },
    });
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "36小说网", url: "https://www.36xs.net", json: paginatedJson, enabled: true, last_used_at: null },
    ]);
    const p1 = `<html><body><div id="content"><p>第004章第一页内容。</p></div><a id="next" href="/56/56445/6516910_1.html">下一页</a></body></html>`;
    const p2 = `<html><body><div id="content"><p>第004章第二页内容。</p></div><a id="next" href="/56/56445/6516910_2.html">下一页</a></body></html>`;
    const p3 = `<html><body><div id="content"><p>第004章第三页内容。</p></div></body></html>`;
    vi.mocked(api.httpGet).mockImplementation(async (url) => {
      if (url === "https://www.36xs.net/56/56445/6516910.html") return p1;
      if (url === "https://www.36xs.net/56/56445/6516910_1.html") return p2;
      return p3;
    });
    render(<ReaderPage source={{ kind: "source", sourceId: 1, bookUrl: "https://www.36xs.net/56_56445/", bookTitle: "测试书", chapterIndex: 3, chapterUrl: "https://www.36xs.net/56/56445/6516910.html", chapterName: "第004章" }} onBack={() => {}} />);
    // 三页内容全部拼接渲染（同一章节，非跳章）；content 提取为纯文本，用子串匹配
    expect(await screen.findByText(/第004章第一页内容。/)).toBeInTheDocument();
    expect(screen.getByText(/第004章第二页内容。/)).toBeInTheDocument();
    expect(screen.getByText(/第004章第三页内容。/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("第004章");
  });
});
