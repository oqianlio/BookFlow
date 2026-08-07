import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  ruleContent: { content: "#content", nextContentUrl: "" },
});

describe("SourceReaderPage", () => {
  it("fetches and renders chapter content", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<html><body><div id="content"><p>第一章正文内容。</p></div></body></html>`,
    );
    render(<SourceReaderPage sourceId={1} bookUrl="https://ex.com/book/1.html" bookTitle="三体"
      initialChapterIndex={0} initialChapterUrl="https://ex.com/c/1.html" initialChapterName="第一章" onBack={() => {}} />);
    expect(await screen.findByText("第一章正文内容。")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
  });
});
