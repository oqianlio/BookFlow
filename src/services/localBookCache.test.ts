import { describe, it, expect, vi, beforeEach } from "vitest";
import { readLocalText, clearLocalTextCache } from "./localBookCache";
import { readFileContent } from "./api";

vi.mock("./api", () => ({ readFileContent: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); clearLocalTextCache(); });

describe("localBookCache", () => {
  it("reads through to the file on first access and reuses the cache afterwards", async () => {
    vi.mocked(readFileContent).mockResolvedValue("内容A");
    expect(await readLocalText("/a.txt")).toBe("内容A");
    expect(await readLocalText("/a.txt")).toBe("内容A");
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest file beyond the limit", async () => {
    vi.mocked(readFileContent).mockImplementation(async (p: string) => `内容${p}`);
    for (let i = 0; i < 7; i++) await readLocalText(`/f${i}.txt`);
    // 最旧的 /f0.txt 被淘汰：重新读取会再次调用 readFileContent（7 首次 + 1 重读）
    await readLocalText("/f0.txt");
    expect(readFileContent).toHaveBeenCalledTimes(8);
  });
});
