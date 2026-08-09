import { describe, it, expect } from "vitest";
import { extractBookSourceFromText } from "./bookSourceImport";

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
