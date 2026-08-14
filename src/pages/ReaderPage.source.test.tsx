import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReaderPage from "./ReaderPage";
import { ErrorProvider } from "../components/ErrorDialog";
import * as api from "../services/api";

vi.mock("../readers/EpubReader", () => ({ default: () => null }));
vi.mock("../readers/PdfReader", () => ({ default: () => null }));
vi.mock("../readers/MdReader", () => ({ default: () => null }));
vi.mock("../readers/TxtReader", () => ({ default: () => null }));

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  saveBookSourceProgress: vi.fn().mockResolvedValue(undefined),
  openLoginWindow: vi.fn().mockResolvedValue(undefined),
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

  it("shows the error dialog and retry button when a chapter fails, and recovers on retry", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet)
      .mockRejectedValueOnce(new Error("网络错误"))
      .mockResolvedValueOnce(ch1);
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
