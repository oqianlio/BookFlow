import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SwitchSourcePanel from "./SwitchSourcePanel";
import * as searchService from "../services/searchService";

vi.mock("../services/searchService", () => ({ searchBookSources: vi.fn() }));
vi.mock("../services/api", () => ({
  listBookSources: vi.fn().mockResolvedValue([
    { id: 1, name: "当前源", url: "https://a.com", json: "{}", enabled: true, last_used_at: null },
    { id: 2, name: "源B", url: "https://b.com", json: "{}", enabled: true, last_used_at: null },
    { id: 3, name: "源C", url: "https://c.com", json: "{}", enabled: true, last_used_at: null },
    { id: 4, name: "禁用源", url: "https://d.com", json: "{}", enabled: false, last_used_at: null },
  ]),
}));

const hits = [
  { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://b.com/1.html", sourceId: 2, sourceName: "源B" },
  { title: "三体", author: "刘慈欣", coverUrl: "", bookUrl: "https://c.com/1.html", sourceId: 3, sourceName: "源C" },
];

beforeEach(() => vi.clearAllMocks());

describe("SwitchSourcePanel", () => {
  it("searches with title+author excluding the current source", async () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue(hits);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    await screen.findByText("源B");
    // 排除当前源 id=1 且不包含禁用源 id=4
    expect(searchService.searchBookSources).toHaveBeenCalledWith("三体 刘慈欣", { sourceIds: [2, 3] });
  });

  it("renders candidates and calls onPick on click", async () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue(hits);
    const onPick = vi.fn();
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={onPick} onClose={() => {}} />);
    fireEvent.click(await screen.findByText("源B"));
    expect(onPick).toHaveBeenCalledWith(hits[0]);
  });

  it("shows empty state when no candidates found", async () => {
    vi.mocked(searchService.searchBookSources).mockResolvedValue([]);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/未在其它书源找到/)).toBeInTheDocument();
  });

  it("shows failure state with retry", async () => {
    vi.mocked(searchService.searchBookSources)
      .mockRejectedValueOnce(new Error("网络错误"))
      .mockResolvedValueOnce(hits);
    render(<SwitchSourcePanel title="三体" author="刘慈欣" excludeSourceId={1} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/搜索失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("源B")).toBeInTheDocument();
  });
});
