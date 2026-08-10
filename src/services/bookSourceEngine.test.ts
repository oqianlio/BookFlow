import { describe, it, expect } from "vitest";
import { parseHtml, extractSingle, extractList, extractFromJsObject, parseBookSourceJson, evalJs, emptyDoc, purifyContent, splitAlternatives, resolveTagIndex } from "./bookSourceEngine";
import { md5 } from "./md5";
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

describe("tag.x index selector", () => {
  it("resolves tag.x index selector", () => {
    const doc = parseHtml(`<div><a class="x" href="/1">一</a><a class="x" href="/2">二</a><a class="x" href="/3">三</a></div>`);
    const el = doc.querySelector("div")!;
    const second = resolveTagIndex("tag.a.1", el);
    expect(second?.getAttribute("href")).toBe("/2");
  });

  it("returns null for out-of-range tag index", () => {
    const doc = parseHtml(`<div><a href="/1">一</a></div>`);
    const el = doc.querySelector("div")!;
    expect(resolveTagIndex("tag.a.5", el)).toBeNull();
  });

  it("extracts via tag.x in extractSingle", () => {
    const doc = parseHtml(`<div><a href="/1">一</a><a href="/2">二</a></div>`);
    const href = extractSingle(doc, "tag.a.1@href", { baseUrl: "https://ex.com" });
    expect(href).toBe("https://ex.com/2");
  });

  it("extracts via tag.x in extractList item rules", () => {
    const doc = parseHtml(`<ul><li><a class="t" href="/a">甲</a><span class="t">乙</span></li><li><a class="t" href="/c">丙</a><span class="t">丁</span></li></ul>`);
    const list = extractList(doc, "ul > li", { url: "tag.a.0@href", name: "tag.a.0@text" }, { baseUrl: "https://ex.com" });
    expect(list.length).toBe(2);
    expect(list[0].url).toBe("https://ex.com/a");
    expect(list[1].url).toBe("https://ex.com/c");
  });

  it("extracts @textNodes joining all descendant text", () => {
    const doc = parseHtml(`<div class="content"><p>第一段</p><p>第二段</p><span>附注</span></div>`);
    const out = extractSingle(doc, ".content@textNodes");
    expect(out).toContain("第一段");
    expect(out).toContain("第二段");
    expect(out).toContain("附注");
  });
});

describe("evalJs extended", () => {
  const doc = emptyDoc();

  it("returns string value", () => {
    expect(evalJs("'hello'", { doc })).toBe("hello");
  });

  it("returns number without forcing String", () => {
    expect(evalJs("1 + 2", { doc })).toBe(3);
  });

  it("returns object/array value", () => {
    const r = evalJs("({a: 1})", { doc });
    expect(r).toEqual({ a: 1 });
  });

  it("injects key/page/result/source context", () => {
    const r = evalJs("key + ':' + page + ':' + result", { doc, key: "斗破", page: 2, result: "HTML" });
    expect(r).toBe("斗破:2:HTML");
  });

  it("java.encodeURI encodes", () => {
    expect(evalJs("java.encodeURI('你好')", { doc })).toBe(encodeURIComponent("你好"));
  });

  it("java.base64Decode decodes utf8", () => {
    expect(evalJs("java.base64Decode('5L2g5aW9')", { doc })).toBe("你好");
  });

  it("java.md5 hashes", () => {
    expect(evalJs("java.md5('abc')", { doc })).toBe(md5("abc"));
  });

  it("java.regex extracts group", () => {
    expect(evalJs("java.regex('id-123', 'id-(\\\\d+)')", { doc })).toBe("123");
  });

  it("returns empty string on exception, does not throw", () => {
    const r = evalJs("null.x", { doc });
    expect(r).toBeFalsy();
  });
});

describe("md5", () => {
  it("matches known vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});

describe("extractList @js: branch", () => {
  const jsList = "@js:JSON.parse(result).data";
  const itemRules = { name: "$.book_name", author: "$.author", bookUrl: "$.book_id" };

  it("parses JSON array returned by @js:", () => {
    const doc = emptyDoc();
    const items = extractList(doc, jsList, itemRules, { result: JSON.stringify({ data: [
      { book_name: "三体", author: "刘慈欣", book_id: "1" },
      { book_name: "活着", author: "余华", book_id: "2" },
    ] }) });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("三体");
    expect(items[1].author).toBe("余华");
  });

  it("handles @js: returning an array directly", () => {
    const doc = emptyDoc();
    const items = extractList(doc, "@js:[{a:'x'},{a:'y'}]", { a: "$.a" }, {});
    expect(items.length).toBe(2);
    expect(items[0].a).toBe("x");
  });

  it("extractFromJsObject supports $.field and plain field", () => {
    expect(extractFromJsObject({ name: "N", id: 7 }, "$.name")).toBe("N");
    expect(extractFromJsObject({ name: "N", id: 7 }, "id")).toBe("7");
  });

  it("extractFromJsObject handles @js: rule with result as object", () => {
    const rule = "@js:'https://x.com/api/' + result.book_id";
    expect(extractFromJsObject({ book_id: "9" }, rule)).toBe("https://x.com/api/9");
  });

  it("extractFromJsObject returns empty for missing field", () => {
    expect(extractFromJsObject({ a: 1 }, "$.missing")).toBe("");
  });
});
