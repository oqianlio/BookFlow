import { describe, it, expect } from "vitest";
import { parseHtml, extractSingle, extractList, parseBookSourceJson, evalJs, purifyContent, splitAlternatives } from "./bookSourceEngine";
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

  it("strips scripts and ad nodes", () => {
    const out = purifyContent(`<div>正文<script>alert(1)</script><ins>广告</ins>继续</div>`);
    expect(out).not.toContain("alert");
    expect(out).not.toContain("广告");
    expect(out).toContain("正文");
    expect(out).toContain("继续");
  });

  it("applies ## replace rules", () => {
    const out = purifyContent(`<div>旧词1旧词2</div>`, ["##旧词##新词##"]);
    expect(out).toContain("新词1新词2");
    expect(out).not.toContain("旧词");
  });

  it("skips invalid replace patterns without throwing", () => {
    const out = purifyContent(`<div>正文内容</div>`, ["##\\p{L}##x##"]);
    expect(out).toContain("正文内容");
  });

  it("skips empty replace patterns without corrupting content", () => {
    const out = purifyContent(`正文内容`, ["####"]);
    expect(out).toBe("正文内容");
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

describe("rule alternatives (||)", () => {
  it("splits || alternatives", () => {
    expect(splitAlternatives("a@text||b@text")).toEqual(["a@text", "b@text"]);
    expect(splitAlternatives("single@text")).toEqual(["single@text"]);
  });

  it("uses first non-empty alternative", () => {
    const doc = parseHtml(`<div><span class="a"></span><p class="b">命中</p></div>`);
    const out = extractSingle(doc, "span.a@text||p.b@text");
    expect(out).toBe("命中");
  });

  it("falls through when first alternative empty", () => {
    const doc = parseHtml(`<div><p class="b">只有B</p></div>`);
    const out = extractSingle(doc, "span.a@text||p.b@text");
    expect(out).toBe("只有B");
  });

  it("handles tag.x inside alternatives", () => {
    const doc = parseHtml(`<div><a class="x" href="/1">一</a><a class="x" href="/2">二</a></div>`);
    const out = extractSingle(doc, "tag.a.0@href||tag.a.1@href", { baseUrl: "https://ex.com" });
    expect(out).toBe("https://ex.com/1");
  });
});
