import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitBookSource, extractBookSourceFromText, importBookSourceFromFile, importBookSourceFromUrl } from "./bookSourceImport";
import * as api from "./api";

vi.mock("./api", () => ({
  httpGet: vi.fn(),
  readFileContent: vi.fn(),
  addBookSource: vi.fn(),
}));

const VALID = { bookSourceName: "测试书源", bookSourceUrl: "https://ex.com" };

describe("extractBookSourceFromText", () => {
  it("parses a single JSON object", () => {
    expect(extractBookSourceFromText(JSON.stringify(VALID))).toMatchObject(VALID);
  });

  it("picks first valid from JSON array", () => {
    const arr = JSON.stringify([{ foo: 1 }, VALID, { bar: 2 }]);
    expect(extractBookSourceFromText(arr)).toMatchObject(VALID);
  });

  it("extracts from <pre> in HTML", () => {
    const html = `<html><body><pre>${JSON.stringify(VALID)}</pre></body></html>`;
    expect(extractBookSourceFromText(html)).toMatchObject(VALID);
  });

  it("extracts inline bookSource JSON in HTML", () => {
    const html = `<html><body><script>window.bookSource = ${JSON.stringify(VALID)};</script></body></html>`;
    expect(extractBookSourceFromText(html)).toMatchObject(VALID);
  });

  it("throws when no book source found", () => {
    expect(() => extractBookSourceFromText("<html><body>无内容</body></html>")).toThrow();
  });
});

describe("validateBookSource (@js: now allowed)", () => {
  it("accepts @js: sources now", () => {
    const jsSrc = { bookSourceName: "X", bookSourceUrl: "https://x.com", searchUrl: "@js:var a=1;" };
    expect(() => extractBookSourceFromText(JSON.stringify(jsSrc))).not.toThrow();
  });

  it("accepts <js> sources", () => {
    const jsSrc = { bookSourceName: "X", bookSourceUrl: "https://x.com", ruleSearch: { bookList: "<js>eval(1)</js>" } };
    expect(() => extractBookSourceFromText(JSON.stringify(jsSrc))).not.toThrow();
  });

  it("accepts pure CSS sources", () => {
    const cssSrc = { bookSourceName: "X", bookSourceUrl: "https://x.com", ruleSearch: { bookList: ".list li", name: "a@text" } };
    expect(extractBookSourceFromText(JSON.stringify(cssSrc))).toMatchObject(cssSrc);
  });

  it("accepts @js: source via URL import", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(JSON.stringify({ bookSourceName: "X", bookSourceUrl: "https://x.com", searchUrl: "@js:var a=1;" }));
    await expect(importBookSourceFromUrl("https://x.com/src.json")).resolves.toMatchObject({ name: "X", url: "https://x.com" });
  });
});

describe("bookSourceImport async functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports from URL passing 20s timeout and parsed source", async () => {
    vi.mocked(api.httpGet).mockResolvedValue(JSON.stringify({ bookSourceName: "X", bookSourceUrl: "https://x.com" }));
    vi.mocked(api.addBookSource).mockResolvedValue(1);
    const r = await importBookSourceFromUrl("  https://x.com/src.json  ");
    expect(api.httpGet).toHaveBeenCalledWith("https://x.com/src.json", undefined, 20000);
    expect(r.name).toBe("X");
    await commitBookSource(r.bookSource);
    expect(api.addBookSource).toHaveBeenCalledWith("X", "https://x.com", JSON.stringify({ bookSourceName: "X", bookSourceUrl: "https://x.com" }));
  });

  it("rejects empty URL", async () => {
    await expect(importBookSourceFromUrl("   ")).rejects.toThrow("请输入书源网址");
    expect(api.httpGet).not.toHaveBeenCalled();
  });

  it("imports from file via readFileContent", async () => {
    vi.mocked(api.readFileContent).mockResolvedValue(JSON.stringify({ bookSourceName: "Y", bookSourceUrl: "https://y.com" }));
    const r = await importBookSourceFromFile("/path/source.json");
    expect(api.readFileContent).toHaveBeenCalledWith("/path/source.json");
    expect(r.url).toBe("https://y.com");
  });
});
