import { describe, it, expect } from "vitest";
import { parseHtml, extractSingle, extractList, parseBookSourceJson, evalJs } from "./bookSourceEngine";
import { SAMPLE_HTML, SAMPLE_SOURCE } from "./fixtures";

describe("bookSourceEngine", () => {
  const doc = parseHtml(SAMPLE_HTML);

  it("extracts a single CSS value with text", () => {
    expect(extractSingle(doc, "a.b-name@text", { baseUrl: "https://example.com" })).toBe("三体");
  });

  it("extracts href and resolves to absolute URL", () => {
    const href = extractSingle(doc, "a.b-name@href", { baseUrl: "https://example.com" });
    expect(href).toBe("https://example.com/book/1.html");
  });

  it("extracts a list of items", () => {
    const list = extractList(doc, "@css:ul.book-list>li", {
      name: "a.b-name@text",
      bookUrl: "a.b-name@href",
      coverUrl: "img.b-cover@src",
    }, { baseUrl: "https://example.com" });
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("三体");
    expect(list[1].bookUrl).toBe("https://example.com/book/2.html");
  });

  it("parses a valid book source JSON", () => {
    const src = parseBookSourceJson(JSON.stringify(SAMPLE_SOURCE));
    expect(src.bookSourceName).toBe("示例书源");
    expect(src.ruleSearch.name).toBe("a.b-name@text");
  });

  it("rejects invalid book source JSON", () => {
    expect(() => parseBookSourceJson("{}")).toThrow();
  });
});

describe("evalJs", () => {
  it("evaluates @js: expression with node context", () => {
    const doc2 = parseHtml(`<a href="/x/1.html">书名</a>`);
    const node = doc2.querySelector("a")!;
    const out = evalJs("node.getAttribute('href')", { node, doc: doc2, baseUrl: "https://ex.com" });
    expect(out).toBe("/x/1.html");
  });

  it("evaluates @js: with java.base64", () => {
    const doc3 = parseHtml("<html><body></body></html>");
    const out = evalJs("java.base64Decode('5L2g5aW9')", { doc: doc3, baseUrl: "https://ex.com" });
    expect(out).toBe("你好");
  });

  it("extracts list via @xpath:", () => {
    const doc4 = parseHtml(SAMPLE_HTML);
    const list = extractList(doc4, "@xpath://ul[@class='book-list']/li", { name: "a.b-name@text" });
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("三体");
  });
});
