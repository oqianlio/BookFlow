import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RssArticlePage from "./RssArticlePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  getRssArticle: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("RssArticlePage", () => {
  it("renders sanitized article content", async () => {
    vi.mocked(api.getRssArticle).mockResolvedValue({
      id: 10, feed_id: 1, guid: "g1", title: "文章甲",
      link: "https://ex.com/a1", content: "<p>正文内容 <script>alert(1)</script></p>",
      published_at: 1704067200, fetched_at: 1,
    });
    render(<RssArticlePage articleId={10} onBack={() => {}} />);
    expect(await screen.findByText("文章甲")).toBeInTheDocument();
    expect(screen.getByText(/正文内容/)).toBeInTheDocument();
    // DOMPurify 移除 script
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows placeholder when content is empty", async () => {
    vi.mocked(api.getRssArticle).mockResolvedValue({
      id: 11, feed_id: 1, guid: "g2", title: "空文章",
      link: null, content: "", published_at: null, fetched_at: 1,
    });
    const { container } = render(<RssArticlePage articleId={11} onBack={() => {}} />);
    await screen.findByText("空文章");
    expect(container.querySelector(".md-content")?.textContent).toContain("无正文内容");
  });
});
