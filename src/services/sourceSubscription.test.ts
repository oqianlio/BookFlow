import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "./api";
import { syncSubscription } from "./sourceSubscription";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  listBookSources: vi.fn(),
  addBookSource: vi.fn().mockResolvedValue(1),
  updateBookSource: vi.fn().mockResolvedValue(undefined),
}));

const remoteJson = JSON.stringify([
  { bookSourceUrl: "https://a.com", bookSourceName: "源A", ruleSearch: {} },
  { bookSourceUrl: "https://b.com", bookSourceName: "源B", ruleSearch: {} },
]);

const sub = { id: 1, name: "合集", url: "https://repo.com/a.json", last_checked_at: null };

beforeEach(() => vi.clearAllMocks());

describe("syncSubscription", () => {
  it("adds new sources and updates changed ones", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(remoteJson);
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 10, name: "源A", url: "https://a.com", json: JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A" }), enabled: true, last_used_at: null },
    ]);
    const r = await syncSubscription(sub);
    expect(r.added).toBe(1);   // 源B 新增
    expect(r.updated).toBe(1); // 源A 更新（json 变化）
    expect(api.addBookSource).toHaveBeenCalledTimes(1);
    expect(api.updateBookSource).toHaveBeenCalledTimes(1);
  });

  it("skips unchanged sources", async () => {
    const sameJson = JSON.stringify({ bookSourceUrl: "https://a.com", bookSourceName: "源A", ruleSearch: {} });
    vi.mocked(api.httpGet).mockResolvedValue(JSON.stringify([JSON.parse(sameJson)]));
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 10, name: "源A", url: "https://a.com", json: sameJson, enabled: true, last_used_at: null },
    ]);
    const r = await syncSubscription(sub);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
    expect(api.updateBookSource).not.toHaveBeenCalled();
  });

  it("counts failures and continues", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(remoteJson);
    vi.mocked(api.listBookSources).mockResolvedValue([]);
    vi.mocked(api.addBookSource).mockRejectedValueOnce(new Error("db 错误")).mockResolvedValueOnce(2);
    const r = await syncSubscription(sub);
    expect(r.failed).toBe(1);
    expect(r.added).toBe(1);
  });
});
