import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoverPage from "./DiscoverPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  listBookSources: vi.fn(),
  httpGet: vi.fn(),
}));

describe("DiscoverPage", () => {
  it("searches enabled sources and lists hits", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "示例书源", url: "https://ex.com", json: JSON.stringify({
        bookSourceUrl: "https://ex.com", bookSourceName: "示例书源",
        searchUrl: "https://ex.com/search?q={{key}}",
        ruleSearch: { bookList: "@css:li", name: ".name@text", author: ".author@text", bookUrl: ".name@href" },
      }), enabled: true, last_used_at: null },
    ]);
    vi.mocked(api.httpGet).mockResolvedValue(
      `<ul><li><span class="name">三体</span><span class="author">刘慈欣</span><a class="name" href="/b/1.html"></a></li></ul>`,
    );
    render(<DiscoverPage onBack={() => {}} onOpenBook={() => {}} />);
    await userEvent.type(screen.getByLabelText("搜索关键词"), "三体");
    await userEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText(/示例书源/)).toBeInTheDocument();
  });
});
