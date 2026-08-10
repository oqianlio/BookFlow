import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExplorePage from "./ExplorePage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
  mergeUserAgent: vi.fn((h?: any) => h),
}));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  exploreUrl: "玄幻::/sort/1_{{page}}.html\n都市::/sort/2_{{page}}.html",
  ruleExplore: { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" },
});

describe("ExplorePage", () => {
  it("renders categories and fetches books on click", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "测试", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li></ul>`,
    );
    render(<ExplorePage sourceId={1} sourceName="测试" onBack={() => {}} onOpenBook={() => {}} />);
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    expect(screen.getByText("都市")).toBeInTheDocument();
    await userEvent.click(screen.getByText("玄幻"));
    await waitFor(() => expect(screen.getByText("三体")).toBeInTheDocument());
  });
});
