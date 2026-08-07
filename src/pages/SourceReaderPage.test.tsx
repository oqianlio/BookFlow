import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SourceReaderPage from "./SourceReaderPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  saveBookSourceProgress: vi.fn().mockResolvedValue(undefined),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleContent: { content: "#content", nextContentUrl: "a#next@href" },
});

const ch1 = `<html><body><div id="content"><p>第一章正文内容。</p></div><a id="next" href="/c/2.html">下一章</a></body></html>`;
const ch2 = `<html><body><div id="content"><p>第二章正文内容。</p></div><a id="next" href="/c/3.html">下一章</a></body></html>`;
const ch3 = `<html><body><div id="content"><p>第三章正文内容。</p></div><a id="next" href="/c/4.html">下一章</a></body></html>`;

function renderReader() {
  return render(<SourceReaderPage sourceId={1} bookUrl="https://ex.com/book/1.html" bookTitle="三体"
    initialChapterIndex={0} initialChapterUrl="https://ex.com/c/1.html" initialChapterName="第一章" onBack={() => {}} />);
}

describe("SourceReaderPage", () => {
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
    expect(screen.getByText("第 2 章")).toBeInTheDocument();
    expect(prevBtn).toBeEnabled();

    fireEvent.click(prevBtn);
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("第 1 章")).toBeInTheDocument();
    expect(prevBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一章" })).toBeEnabled();
  });
});
