import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SourceBookPage from "./SourceBookPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  httpGet: vi.fn(),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
  listBookSources: vi.fn(),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "示例",
  ruleBookInfo: { name: "h1@text", author: ".author@text" },
  ruleToc: {
    chapterList: "@css:ol>li",
    chapterName: "a@text", chapterUrl: "a@href", nextTocUrl: "",
  },
});

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
});
