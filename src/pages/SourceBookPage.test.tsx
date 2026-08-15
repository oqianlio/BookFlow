import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SourceBookPage from "./SourceBookPage";
import * as api from "../services/api";
import { clearTocCache } from "../services/sourceToc";

vi.mock("../components/SwitchSourcePanel", () => ({
  default: (props: any) => (
    <div data-testid="switch-panel">
      <button onClick={() => props.onPick({ title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://c.com/b.html", sourceId: 3, sourceName: "源C" })}>
        pick-c
      </button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}));

vi.mock("../services/api", () => ({
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  listBookSources: vi.fn(),
  openLoginWindow: vi.fn().mockResolvedValue(undefined),
  listShelfSourceBooks: vi.fn().mockResolvedValue([]),
  addShelfSourceBook: vi.fn().mockResolvedValue(1),
  removeShelfSourceBook: vi.fn().mockResolvedValue(undefined),
  saveCachedChapter: vi.fn().mockResolvedValue(undefined),
  listCachedChapters: vi.fn().mockResolvedValue([]),
  getReadingStats: vi.fn().mockResolvedValue(null),
  mergeUserAgent: (h: Record<string, string> | undefined, ua: string | undefined) =>
    ua && !Object.keys(h ?? {}).some((k) => k.toLowerCase() === "user-agent")
      ? { ...(h ?? {}), "User-Agent": ua }
      : h,
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: {
    chapterList: "@css:ol>li",
    chapterName: "a@text", chapterUrl: "a@href", nextTocUrl: "",
  },
});

const coverSourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text", coverUrl: ".cover img@src" },
  ruleToc: { chapterList: "@css:ol>li", chapterName: "a@text", chapterUrl: "a@href", nextTocUrl: "" },
});

beforeEach(() => { vi.clearAllMocks(); clearTocCache(); });

describe("SourceBookPage", () => {
  it("renders book info and chapter list", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><span class="author">刘慈欣</span><ol>
        <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`,
    );
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(screen.getByText("第二章")).toBeInTheDocument();
  });

  it("keeps the confirmed book title even when the source parses a different one", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体_笔趣阁无弹窗</h1><span class="author">刘慈欣</span><ol>
        <li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    // 书名以用户确认的「三体」为准，不被源解析的杂质书名覆盖（换源后保持同一本书）
    expect(await screen.findByText("三体", { selector: ".source-book-title" })).toBeInTheDocument();
    expect(screen.queryByText("三体_笔趣阁无弹窗")).not.toBeInTheDocument();
  });

  it("开始阅读 resumes by passing chapterIndex -1", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    const onRead = vi.fn();
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={onRead} />);
    fireEvent.click(await screen.findByRole("button", { name: "开始阅读" }));
    expect(onRead).toHaveBeenCalledWith(-1, "", "");
  });

  it("shows 登录 button when source has loginUrl and opens the login window on click", async () => {
    const src = JSON.parse(sourceJson);
    src.loginUrl = "https://ex.com/login";
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: JSON.stringify(src), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    const btn = await screen.findByRole("button", { name: "登录" });
    fireEvent.click(btn);
    expect(api.openLoginWindow).toHaveBeenCalledWith("https://ex.com/login", "ex.com");
  });

  it("hides 登录 button when source has no loginUrl", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1></body></html>`,
    );
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
  });

  it("passes the source hostname as cookieJar to book and toc httpGet calls", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><span class="author">刘慈欣</span><ol>
        <li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    await screen.findByText("第一章");
    const calls = vi.mocked(api.httpGet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[6]).toBe("ex.com");
  });

  it("renders cover image when ruleBookInfo provides coverUrl", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><div class="cover"><img src="https://cdn.com/c.jpg"></div><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: coverSourceJson, enabled: true, last_used_at: null },
    ]);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    const img = document.querySelector("img.source-book-cover") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://cdn.com/c.jpg");
    expect(screen.getByRole("heading", { name: /目录/ })).toBeInTheDocument();
    expect(screen.getByText("共 1 章")).toBeInTheDocument();
  });

  it("resolves relative cover URLs against the book URL", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><div class="cover"><img src="/files/c.jpg"></div><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: coverSourceJson, enabled: true, last_used_at: null },
    ]);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    await screen.findByText("三体");
    const img = document.querySelector("img.source-book-cover") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://ex.com/files/c.jpg");
  });

  it("adds the book to the shelf and toggles back", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    const addBtn = await screen.findByRole("button", { name: "加入书架" });
    fireEvent.click(addBtn);
    expect(api.addShelfSourceBook).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 1, bookUrl: "https://ex.com/book/1.html", title: "三体",
    }));
    expect(await screen.findByRole("button", { name: "已在书架" })).toBeInTheDocument();
  });

  it("shows 已在书架 when the book is already on the shelf", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.listShelfSourceBooks).mockResolvedValue([
      { id: 9, source_id: 1, source_name: "示例", book_url: "https://ex.com/book/1.html", title: "三体", author: null, cover_url: null, added_at: 1, last_opened_at: null },
    ]);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    const btn = await screen.findByRole("button", { name: "已在书架" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.removeShelfSourceBook).toHaveBeenCalledWith(9));
    expect(await screen.findByRole("button", { name: "加入书架" })).toBeInTheDocument();
  });

  it("opens the switch source panel and calls onSwitchSource on pick", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    const onSwitchSource = vi.fn();
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} onSwitchSource={onSwitchSource} />);
    fireEvent.click(await screen.findByRole("button", { name: "换源" }));
    expect(document.querySelector('[data-testid="switch-panel"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pick-c" }));
    expect(onSwitchSource).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 3, sourceName: "源C" }));
    // 选择后面板关闭
    expect(document.querySelector('[data-testid="switch-panel"]')).toBeNull();
  });

  it("downloads the whole book via 缓存全书 and reports completion", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockImplementation(async (url: string) => {
      if (url === "https://ex.com/book/1.html") {
        return `<html><body><h1>三体</h1><ol>
          <li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ol></body></html>`;
      }
      return `<html><body><div id="content"><p>章节正文。</p></div></body></html>`;
    });
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    const btn = await screen.findByRole("button", { name: "缓存全书" });
    fireEvent.click(btn);
    expect(await screen.findByRole("button", { name: /已缓存 2 章/ })).toBeInTheDocument();
    expect(api.saveCachedChapter).toHaveBeenCalledTimes(2);
  });

  it("shows reading stats when available", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.getReadingStats).mockResolvedValue({
      source_id: 1, book_url: "https://ex.com/book/1.html", title: "三体",
      read_seconds: 3660, read_count: 5, last_read_at: 1784200000,
    });
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    expect(await screen.findByText(/1 小时 1 分钟/)).toBeInTheDocument();
    expect(screen.getByText(/阅读 5 次/)).toBeInTheDocument();
    expect(screen.getByText(/最近/)).toBeInTheDocument();
  });

  it("hides stats when none recorded", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><h1>三体</h1><ol><li><a href="/c/1.html">第一章</a></li></ol></body></html>`,
    );
    vi.mocked(api.getReadingStats).mockResolvedValue(null);
    render(<SourceBookPage sourceId={1} sourceName="示例" bookUrl="https://ex.com/book/1.html" initialTitle="三体" onBack={() => {}} onRead={() => {}} />);
    await screen.findByText("三体");
    expect(screen.queryByText(/阅读次数/)).not.toBeInTheDocument();
  });
});
