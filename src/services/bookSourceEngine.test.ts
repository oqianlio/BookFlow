import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseHtml, extractSingle, extractList, extractFromJsObject, parseBookSourceJson, evalJs, emptyDoc, purifyContent, splitAlternatives, resolveTagIndex, resolveSearchUrl, parseExploreUrl, extractBookList, parseRule, jsonGet, extractFromJsonObject } from "./bookSourceEngine";
import { isImageChapter, extractImageUrls } from "./bookSourceEngine";
import { md5 } from "./md5";
import { loadJsLib } from "./jsLib";
import { SAMPLE_HTML, SAMPLE_SOURCE } from "./fixtures";

const { httpGetMock, mergeUserAgentMock } = vi.hoisted(() => ({
  httpGetMock: vi.fn(),
  mergeUserAgentMock: vi.fn((headers?: Record<string, string> | undefined, userAgent?: string) => {
    if (!userAgent) return headers;
    const hasUa = Object.keys(headers ?? {}).some((k) => k.toLowerCase() === "user-agent");
    if (hasUa) return headers;
    return { ...(headers ?? {}), "User-Agent": userAgent };
  }),
}));

vi.mock("./api", () => ({
  httpGet: httpGetMock,
  mergeUserAgent: mergeUserAgentMock,
}));

describe("bookSourceEngine", () => {
  const doc = parseHtml(SAMPLE_HTML);

  it("extracts a single CSS value with text", async () => {
    expect(await extractSingle(doc, "a.b-name@text", { baseUrl: "https://example.com" })).toBe("三体");
  });

  it("extracts href and resolves to absolute URL", async () => {
    const href = await extractSingle(doc, "a.b-name@href", { baseUrl: "https://example.com" });
    expect(href).toBe("https://example.com/book/1.html");
  });

  it("extracts a list of items", async () => {
    const list = await extractList(doc, "@css:ul.book-list>li", {
      name: "a.b-name@text",
      bookUrl: "a.b-name@href",
      coverUrl: "img.b-cover@src",
    }, { baseUrl: "https://example.com" });
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("三体");
    expect(list[1].bookUrl).toBe("https://example.com/book/2.html");
  });

  it("handles empty list rule without throwing", async () => {
    await expect(extractList(doc, "", { name: "a@text" })).resolves.toEqual([]);
    await expect(extractBookList(doc, {}, {})).resolves.toEqual([]);
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

  it("extracts list via @xpath:", async () => {
    const doc4 = parseHtml(SAMPLE_HTML);
    const list = await extractList(doc4, "@xpath://ul[@class='book-list']/li", { name: "a.b-name@text" });
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("三体");
  });
});

describe("rule alternatives (||)", () => {
  it("splits || alternatives", () => {
    expect(splitAlternatives("a@text||b@text")).toEqual(["a@text", "b@text"]);
    expect(splitAlternatives("single@text")).toEqual(["single@text"]);
  });

  it("uses first non-empty alternative", async () => {
    const doc = parseHtml(`<div><span class="a"></span><p class="b">命中</p></div>`);
    const out = await extractSingle(doc, "span.a@text||p.b@text");
    expect(out).toBe("命中");
  });

  it("falls through when first alternative empty", async () => {
    const doc = parseHtml(`<div><p class="b">只有B</p></div>`);
    const out = await extractSingle(doc, "span.a@text||p.b@text");
    expect(out).toBe("只有B");
  });

  it("handles tag.x inside alternatives", async () => {
    const doc = parseHtml(`<div><a class="x" href="/1">一</a><a class="x" href="/2">二</a></div>`);
    const out = await extractSingle(doc, "tag.a.0@href||tag.a.1@href", { baseUrl: "https://ex.com" });
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

  it("extracts via tag.x in extractSingle", async () => {
    const doc = parseHtml(`<div><a href="/1">一</a><a href="/2">二</a></div>`);
    const href = await extractSingle(doc, "tag.a.1@href", { baseUrl: "https://ex.com" });
    expect(href).toBe("https://ex.com/2");
  });

  it("extracts via tag.x in extractList item rules", async () => {
    const doc = parseHtml(`<ul><li><a class="t" href="/a">甲</a><span class="t">乙</span></li><li><a class="t" href="/c">丙</a><span class="t">丁</span></li></ul>`);
    const list = await extractList(doc, "ul > li", { url: "tag.a.0@href", name: "tag.a.0@text" }, { baseUrl: "https://ex.com" });
    expect(list.length).toBe(2);
    expect(list[0].url).toBe("https://ex.com/a");
    expect(list[1].url).toBe("https://ex.com/c");
  });

  it("extracts @textNodes joining all descendant text", async () => {
    const doc = parseHtml(`<div class="content"><p>第一段</p><p>第二段</p><span>附注</span></div>`);
    const out = await extractSingle(doc, ".content@textNodes");
    expect(out).toContain("第一段");
    expect(out).toContain("第二段");
    expect(out).toContain("附注");
  });
});

describe("evalJs source variables", () => {
  it("java.put/get roundtrips with sourceKey isolation", () => {
    const doc = emptyDoc();
    evalJs("java.put('page','2')", { doc, sourceKey: "ex.com" });
    expect(evalJs("java.get('page')", { doc, sourceKey: "ex.com" })).toBe("2");
    expect(evalJs("java.get('page')", { doc, sourceKey: "other.com" })).toBe("");
  });

  it("source.putVariable/getVariable persist across calls", () => {
    const doc = emptyDoc();
    evalJs("source.putVariable('3,foo')", { doc, sourceKey: "ex.com" });
    expect(evalJs("source.getVariable()", { doc, sourceKey: "ex.com" })).toBe("3,foo");
    expect(evalJs("source.getVariable()", { doc, sourceKey: "other.com" })).toBe("");
  });

  it("TYPE still works after source.getVariable implementation", () => {
    const doc = emptyDoc();
    evalJs("source.putVariable('1,x')", { doc, sourceKey: "ex.com" });
    expect(evalJs("TYPE()", { doc, sourceKey: "ex.com" })).toBe(2);
  });

  it("extractFromJsObject @js: rules forward sourceKey for isolation", () => {
    evalJs("java.put('tag','A')", { doc: emptyDoc(), sourceKey: "ex.com" });
    expect(extractFromJsObject({}, "@js:java.get('tag')", undefined, "ex.com")).toBe("A");
    expect(extractFromJsObject({}, "@js:java.get('tag')", undefined, "other.com")).toBe("");
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

  it("java.base64Encode encodes utf8 (CJK-safe)", () => {
    expect(evalJs("java.base64Encode('你好')", { doc })).toBe("5L2g5aW9");
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

  it("swallows syntax errors in @js: expressions (new Function construction)", () => {
    // 书源 @js: 表达式语法错误（如多余花括号）不得冒泡导致整条规则失败
    const r = evalJs("var x = {; }", { doc });
    expect(r).toBeFalsy();
    const r2 = evalJs("function f( { return 1; }", { doc });
    expect(r2).toBeFalsy();
  });

  it("runs multi-statement scripts returning last expression", () => {
    const r = evalJs("var base='http://x.com'; base + '/api?key=' + java.encodeURI(key)", { doc, key: "斗破" });
    expect(r).toBe("http://x.com/api?key=" + encodeURIComponent("斗破"));
  });

  it("runs multi-statement scripts returning result assignment", () => {
    const r = evalJs("var arr=[1,2,3]; var out=[]; for(var i=0;i<arr.length;i++){out.push(arr[i]*2);} result=out;", { doc });
    expect(r).toEqual([2, 4, 6]);
  });

  it("runs scripts with explicit return statement", () => {
    const r = evalJs("var x = 5; return x * 2;", { doc });
    expect(r).toBe(10);
  });

  it("provides TYPE() mapping source variable to tab type", () => {
    const source = { getVariable: () => "0,foo" };
    const r = evalJs("TYPE()", { doc, source });
    expect(r).toBe(3);
    const r2 = evalJs("TYPE()", { doc, source: { getVariable: () => "1,bar" } });
    expect(r2).toBe(2);
  });

  it("binds this.source in scripts", () => {
    const source = { getVariable: () => "abc" };
    const r = evalJs("String(this.source.getVariable())", { doc, source });
    expect(r).toBe("abc");
  });

  it("java.createSymmetricCrypto encrypts and decrypts", () => {
    const r = evalJs("var c=java.createSymmetricCrypto('AES/ECB/PKCS5Padding','0123456789abcdef'); c.decryptStr(c.encryptBase64('你好'))", { doc: emptyDoc() });
    expect(r).toBe("你好");
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

  it("parses JSON array returned by @js:", async () => {
    const doc = emptyDoc();
    const items = await extractList(doc, jsList, itemRules, { result: JSON.stringify({ data: [
      { book_name: "三体", author: "刘慈欣", book_id: "1" },
      { book_name: "活着", author: "余华", book_id: "2" },
    ] }) });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("三体");
    expect(items[1].author).toBe("余华");
  });

  it("handles @js: returning an array directly", async () => {
    const doc = emptyDoc();
    const items = await extractList(doc, "@js:[{a:'x'},{a:'y'}]", { a: "$.a" }, {});
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

  it("extractFromJsObject evaluates mixed $.field@js: rule with result bound to field value", () => {
    const rule = "$.book_id@js:'https://x.com/api/' + result";
    expect(extractFromJsObject({ book_id: "9" }, rule)).toBe("https://x.com/api/9");
  });

  it("extractFromJsObject evaluates mixed field@js: rule (no $.)", () => {
    const rule = "book_id@js:'id-' + result";
    expect(extractFromJsObject({ book_id: "9" }, rule)).toBe("id-9");
  });

  it("extractFromJsObject returns empty for null/non-object", () => {
    expect(extractFromJsObject(null as any, "$.name")).toBe("");
    expect(extractFromJsObject(undefined as any, "$.name")).toBe("");
    expect(extractFromJsObject("a string", "$.name")).toBe("");
  });

  it("drives full extractList js list -> js item chain with per-source isolation", async () => {
    const doc = emptyDoc();
    const itemRule = { tag: "@js:java.get('tag')" };
    const listA = "@js:java.put('tag','A'); [{a:1},{a:2}]";
    const listB = "@js:[{a:1},{a:2}]";
    const itemsA = await extractList(doc, listA, itemRule, { sourceKey: "src-a" });
    const itemsB = await extractList(doc, listB, itemRule, { sourceKey: "src-b" });
    expect(itemsA[0].tag).toBe("A");
    expect(itemsA[1].tag).toBe("A");
    expect(itemsB[0].tag).toBe("");
    expect(itemsB[1].tag).toBe("");
  });
});

describe("resolveSearchUrl", () => {
  it("handles @js: searchUrl", () => {
    const js = "@js:'https://x.com/api/search?key=' + java.encodeURI(key) + '&page=' + page";
    const r = resolveSearchUrl(js, "斗破", 1);
    expect(r.url).toBe("https://x.com/api/search?key=" + encodeURIComponent("斗破") + "&page=1");
  });

  it("falls back to plain parseSearchUrl for non-@js", () => {
    const r = resolveSearchUrl("https://x.com/search?q={{key}}", "三体", 1);
    expect(r.url).toBe("https://x.com/search?q=" + encodeURIComponent("三体"));
  });
});

describe("parseExploreUrl", () => {
  it("parses category::url lines", () => {
    const r = parseExploreUrl("玄幻::/sort/1_{{page}}.html\n都市::/sort/2_{{page}}.html");
    expect(r).toEqual([
      { title: "玄幻", url: "/sort/1_{{page}}.html" },
      { title: "都市", url: "/sort/2_{{page}}.html" },
    ]);
  });

  it("filters empty lines", () => {
    const r = parseExploreUrl("玄幻::/a.html\n\n\n都市::/b.html");
    expect(r.length).toBe(2);
  });

  it("handles lines without ::", () => {
    const r = parseExploreUrl("仅标题");
    expect(r).toEqual([{ title: "仅标题", url: "仅标题" }]);
  });

  it("evaluates @js: expression with jsLib-defined function", () => {
    loadJsLib("ex.com", "function GEN_EXPLORE(){ return '玄幻::/x/\\n都市::/d/'; }");
    const r = parseExploreUrl("@js:GEN_EXPLORE()", { sourceKey: "ex.com" });
    expect(r).toEqual([
      { title: "玄幻", url: "/x/" },
      { title: "都市", url: "/d/" },
    ]);
  });

  it("jsLib-defined functions can access this.source", () => {
    loadJsLib("tabs.com", "function TAB(){ var v=String(this.source.getVariable()).split(','); return v[0]||'0'; }");
    const r = evalJs("TAB()", { doc: emptyDoc(), source: { getVariable: () => "2" }, sourceKey: "tabs.com" });
    expect(r).toBe("2");
  });

  it("parses @js: returning JSON array", () => {
    const r = parseExploreUrl('@js:[{"title":"玄幻","url":"/x/"},{"title":"都市","url":"/d/"}]', { sourceKey: "none" });
    expect(r).toEqual([
      { title: "玄幻", url: "/x/" },
      { title: "都市", url: "/d/" },
    ]);
  });

  it("parses @js: self-contained expression without jsLib", () => {
    const r = parseExploreUrl('@js:(()=>[{"title":"A","url":"/a/"}])()', {});
    expect(r).toEqual([{ title: "A", url: "/a/" }]);
  });

  it("returns empty array for failing @js: expression", () => {
    expect(parseExploreUrl("@js:null.x", {})).toEqual([]);
  });

  it("parses @js: string with && separator without spurious entries", () => {
    const r = parseExploreUrl('@js:"玄幻::/x/&&都市::/d/"', {});
    expect(r).toEqual([
      { title: "玄幻", url: "/x/" },
      { title: "都市", url: "/d/" },
    ]);
  });

  it("parses plain JSON array exploreUrl without @js prefix", () => {
    const r = parseExploreUrl(
      '[{"title":"玄幻魔法","url":"/novels/class/1_{{page}}.html","style":{}},{"title":"都市言情","url":"/novels/class/3_{{page}}.html"}]',
    );
    expect(r).toEqual([
      { title: "玄幻魔法", url: "/novels/class/1_{{page}}.html" },
      { title: "都市言情", url: "/novels/class/3_{{page}}.html" },
    ]);
  });

  it("filters JSON array entries with empty url", () => {
    const r = parseExploreUrl('[{"title":"标题占位","url":""},{"title":"分类","url":"/x/1.html"}]');
    expect(r).toEqual([{ title: "分类", url: "/x/1.html" }]);
  });

describe("legado ## replace rules", () => {
  it("parseAttrRule splits ## replacement suffix", () => {
    const r = parseRule(".author.0@text##作者：##");
    expect(r.type).toBe("css");
    expect(r.value).toBe(".author.0");
    expect(r.attr).toBe("text");
    expect(r.replace).toEqual([["作者：", ""]]);
  });

  it("extractList applies ## replacement via item rules", async () => {
    const html = `<div class="bookbox">
      <div class="bookname"><a href="/book/1.html">书一</a></div>
      <div class="author"><p>作者：刘慈欣</p></div>
    </div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      name: ".bookname a@text",
      author: ".author.0@text##作者：##",
      bookUrl: ".bookname a@href||.del_but@href",
    }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(1);
    expect(items[0].author).toBe("刘慈欣");
    expect(items[0].bookUrl).toBe("https://ex.com/book/1.html");
  });

  it("supports chained replacements", async () => {
    const html = `<div class="bookbox"><div class="bookname"><a href="/b/1.html">书一</a></div><div class="author">A|B</div></div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      author: ".author.0@text##\\|##、",
    }, { baseUrl: "https://ex.com" });
    expect(items[0].author).toBe("A、B");
  });

  it("ignores invalid replacement regex without throwing", async () => {
    const html = `<div class="bookbox"><div class="bookname"><a href="/b/1.html">书一</a></div><div class="author">作者：X</div></div>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, ".bookbox", {
      author: ".author.0@text##[##",
    }, { baseUrl: "https://ex.com" });
    expect(items[0].author).toBe("作者：X");
  });

  it("extractSingle css path applies replacement", async () => {
    const doc = parseHtml(`<html><body><div class="t">前缀内容</div></body></html>`);
    const v = await extractSingle(doc, ".t@text##前缀##");
    expect(v).toBe("内容");
  });
});

describe("legado xpath and chain element rules", () => {
  it("parseRule recognizes bare XPath and uppercase @XPath:", () => {
    const r = parseRule("//*[@id='allchapter']//dd[a]");
    expect(r.type).toBe("xpath");
    expect(parseRule("@XPath:.//a/text()").type).toBe("xpath");
  });

  it("extractList handles bare XPath chapterList", async () => {
    const html = `<html><body><div id="allchapter"><dd><a href="/c/1.html">第一章</a></dd><dd><a href="/c/2.html">第二章</a></dd></div></body></html>`;
    const doc = parseHtml(html);
    const items = await extractList(doc, "//*[@id='allchapter']//dd[a]", {
      name: "@XPath:.//a/text()", url: "@XPath:.//a/@href",
    }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("第一章");
    expect(items[0].url).toBe("https://ex.com/c/1.html");
  });

  it("extractList handles chained @ element rules with class index", async () => {
    const html = `<div class="clearfix"><ul><li><a href="/c/1.html">第一章</a></li><li><a href="/c/2.html">第二章</a></li></ul></div><div class="clearfix"><ul><li><a href="/x/9.html">X章</a></li></ul></div>`;
    const doc = parseHtml(html);
    // .clearfix.0 = 第 1 个 clearfix（0 基索引，与 tag.x 语义一致）
    const items = await extractList(doc, ".clearfix.0@li@a", { name: "text", url: "href" }, { baseUrl: "https://ex.com" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("第一章");
    expect(items[0].url).toBe("https://ex.com/c/1.html");
  });
});
});

describe("extractBookList", () => {
  it("extracts books from itemRules", async () => {
    const doc = parseHtml(`<ul class="list"><li><a class="n" href="/b/1">三体</a><span class="a">刘慈欣</span></li><li><a class="n" href="/b/2">活着</a><span class="a">余华</span></li></ul>`);
    const rules = { bookList: "ul.list li", name: ".n@text", author: ".a@text", bookUrl: ".n@href" };
    const books = await extractBookList(doc, rules, { baseUrl: "https://ex.com" });
    expect(books.length).toBe(2);
    expect(books[0].name).toBe("三体");
    expect(books[1].bookUrl).toBe("https://ex.com/b/2");
  });
});

describe("image chapter detection", () => {
  it("detects img tags", () => {
    expect(isImageChapter(`<div class="content"><img src="/c/1.jpg"><img src="/c/2.jpg"></div>`)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isImageChapter("这是一段正文文本")).toBe(false);
  });

  it("extracts img src and data-src with baseUrl resolution", () => {
    const html = `<div><img src="/c/1.jpg"><img data-src="https://cdn.com/2.jpg"></div>`;
    const urls = extractImageUrls(html, "https://ex.com/book/1.html");
    expect(urls).toEqual(["https://ex.com/c/1.jpg", "https://cdn.com/2.jpg"]);
  });

  it("returns empty array when no images", () => {
    expect(extractImageUrls("<p>文本</p>", "https://ex.com")).toEqual([]);
  });
});

describe("JSON rule extraction (@Json: / $.)", () => {
  const json = JSON.stringify({
    data: {
      data: {
        book_name: "三体",
        author: "刘慈欣",
        book_id: "123",
        thumb_url: "/cover/1.jpg",
        abstract: "科幻",
        category: "科幻",
        chapterListWithVolume: [
          { title: "第一章", itemId: "c1" },
          { title: "第二章", itemId: "c2" },
        ],
      },
    },
  });

  it("parses @Json: and $. rules as json type", () => {
    expect(parseRule("@Json:data")).toEqual({ type: "json", value: "data" });
    expect(parseRule("$.a.b")).toEqual({ type: "json", value: "$.a.b" });
    expect(parseRule("$[0]")).toEqual({ type: "json", value: "$[0]" });
  });

  it("jsonGet walks nested paths and array indexes", () => {
    const obj = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(jsonGet(obj, "$.a.b[0].c")).toBe(1);
    expect(jsonGet(obj, "$.a.b")).toEqual([{ c: 1 }, { c: 2 }]);
    expect(jsonGet(obj, "$.missing")).toBeUndefined();
    expect(jsonGet({ x: 1 }, "x")).toBe(1);
  });

  it("extractList extracts items from @Json:data", async () => {
    const doc = parseHtml("<div></div>");
    const items = await extractList(doc, "@Json:data.data.chapterListWithVolume", {
      name: "$.title", url: "$.itemId",
    }, { baseUrl: "http://x", result: json, sourceKey: "x" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("第一章");
    expect(items[0].url).toBe("c1");
    expect(items[1].name).toBe("第二章");
  });

  it("extractSingle reads a scalar from $. path", async () => {
    const doc = parseHtml("<div></div>");
    expect(await extractSingle(doc, "$.data.data.book_name", { result: json, sourceKey: "x" })).toBe("三体");
  });

  it("extractFromJsonObject supports @js: composition and URL resolution", () => {
    const item = { book_id: "123", thumb_url: "/cover/1.jpg" };
    const url = extractFromJsonObject(item, "$.book_id@js:'http://x/detail?book_id=' + result", { baseUrl: "http://x" });
    expect(url).toBe("http://x/detail?book_id=123");
    const cover = extractFromJsonObject(item, "$.thumb_url", { baseUrl: "http://x" });
    expect(cover).toBe("http://x/cover/1.jpg");
  });

  it("extractFromJsonObject handles @Json: prefix and @js: combination", () => {
    const obj = { data: [{ id: 7 }] };
    const out = extractFromJsonObject(obj, "@Json:data[0].id@js:'type=' + result", {});
    expect(out).toBe("type=7");
  });

  it("returns empty on invalid JSON without throwing", async () => {
    const doc = parseHtml("<div></div>");
    await expect(extractList(doc, "@Json:data", { name: "$.n" }, { result: "not json", sourceKey: "x" })).resolves.toEqual([]);
    expect(await extractSingle(doc, "$.a", { result: "not json", sourceKey: "x" })).toBe("");
  });
});

describe("JSON rule extraction: real source regression", () => {
  it("real-source: 番茄聚合 ruleExplore extraction", async () => {
    const json = JSON.stringify({
      data: [
        { book_name: "三体", author: "刘慈欣", book_id: "1", thumb_url: "/c/1.jpg", abstract: "科幻", category: "科幻" },
        { book_name: "活着", author: "余华", book_id: "2", thumb_url: "/c/2.jpg", abstract: "小说", category: "小说" },
      ],
    });
    const doc = parseHtml("<div></div>");
    const items = await extractList(doc, "@Json:data", {
      author: "$.author",
      bookUrl: "$.book_id@js:'http://101.35.133.34:5000/api/detail?book_id=' + result",
      coverUrl: "$.thumb_url",
      intro: "$.abstract",
      kind: "$.category",
      name: "$.book_name",
    }, { baseUrl: "http://101.35.133.34:5000", result: json, sourceKey: "x" });
    expect(items).toEqual([
      { author: "刘慈欣", bookUrl: "http://101.35.133.34:5000/api/detail?book_id=1", coverUrl: "http://101.35.133.34:5000/c/1.jpg", intro: "科幻", kind: "科幻", name: "三体" },
      { author: "余华", bookUrl: "http://101.35.133.34:5000/api/detail?book_id=2", coverUrl: "http://101.35.133.34:5000/c/2.jpg", intro: "小说", kind: "小说", name: "活着" },
    ]);
  });

  it("real-source: 番茄聚合 ruleToc chapterList @Json:...@js: flatten", async () => {
    const json = JSON.stringify({ data: { data: { chapterListWithVolume: [[{ title: "一", itemId: "a" }], [{ title: "二", itemId: "b" }]] } } });
    const doc = parseHtml("<div></div>");
    const listRule = "@Json:data.data.chapterListWithVolume@js:\nvar arr=[];\nfor(var i=0;i<result.length;i++){arr=arr.concat(result[i]);}\nresult=arr;";
    const items = await extractList(doc, listRule, { name: "$.title", url: "$.itemId" }, { baseUrl: "http://x", result: json, sourceKey: "x" });
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("一");
    expect(items[1].name).toBe("二");
  });

  it("real-source: ruleBookInfo cover_url via extractSingle resolves against baseUrl", async () => {
    const json = JSON.stringify({ data: { data: { book_name: "三体", cover_url: "/c/1.jpg", book_url: "/book/1" } } });
    const doc = parseHtml("<div></div>");
    const name = await extractSingle(doc, "$.data.data.book_name", { baseUrl: "http://101.35.133.34:5000", result: json, sourceKey: "x" });
    expect(name).toBe("三体");
    const cover = await extractSingle(doc, "$.data.data.cover_url", { baseUrl: "http://101.35.133.34:5000", result: json, sourceKey: "x" });
    expect(cover).toBe("http://101.35.133.34:5000/c/1.jpg");
  });

  it("does not resolve empty URL fields to site root", async () => {
    const json = JSON.stringify({ data: [{ book_name: "无封面", thumb_url: "" }] });
    const doc = parseHtml("<div></div>");
    const items = await extractList(doc, "@Json:data", { name: "$.book_name", coverUrl: "$.thumb_url" }, { baseUrl: "http://x", result: json, sourceKey: "x" });
    expect(items).toEqual([{ name: "无封面", coverUrl: "" }]);
    expect(await extractSingle(doc, "$.data[0].thumb_url", { baseUrl: "http://x", result: json, sourceKey: "x" })).toBe("");
  });
});

describe("jsBlock <js>...</js>", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("parseRule recognizes <js>...</js> as jsBlock with value and after", () => {
    expect(parseRule("<js>java.ajax('https://ex.com/api/chapter');</js>.content@text")).toEqual({
      type: "jsBlock",
      value: "java.ajax('https://ex.com/api/chapter');",
      after: ".content@text",
    });
  });

  it("jsBlock with java.ajax calls httpGet and extracts from its response as context", async () => {
    httpGetMock.mockResolvedValue(`<html><body><div class="content">ajax 响应正文</div></body></html>`);
    const doc = parseHtml(`<html><body><div class="content">原始正文</div></body></html>`);
    const rule = "<js>java.ajax('https://ex.com/api/chapter');</js>.content@text";
    const out = await extractSingle(doc, rule, {
      baseUrl: "https://ex.com",
      source: { httpHeaders: undefined, httpUserAgent: "TestUA" },
      sourceKey: "ex.com",
    });
    expect(httpGetMock).toHaveBeenCalledWith(
      "https://ex.com/api/chapter",
      { "User-Agent": "TestUA" },
      undefined, undefined, undefined, undefined, "",
    );
    expect(out).toBe("ajax 响应正文");
  });

  it("jsBlock without java.ajax extracts from the original doc", async () => {
    const doc = parseHtml(`<html><body><div class="content">原始正文</div></body></html>`);
    const rule = "<js>var x = 1;</js>.content@text";
    const out = await extractSingle(doc, rule, { baseUrl: "https://ex.com" });
    expect(httpGetMock).not.toHaveBeenCalled();
    expect(out).toBe("原始正文");
  });
});

describe("legado XPath string-result rules", () => {
  const doc = parseHtml(`<html><body>
    <div class="title"> 第一章  标题 </div>
    <a href="/c/1.html">链接</a>
  </body></html>`);

  it("extractSingle /text() returns the text node value", async () => {
    const out = await extractSingle(doc, "//div[@class='title']/text()");
    expect(out).toBe("第一章  标题");
  });

  it("extractSingle string() function returns element text", async () => {
    const out = await extractSingle(doc, "string(//div[@class='title'])");
    expect(out).toBe("第一章  标题");
  });

  it("extractSingle normalize-space() trims inner whitespace", async () => {
    const out = await extractSingle(doc, "normalize-space(//div[@class='title'])");
    expect(out).toBe("第一章 标题");
  });

  it("extractSingle //a/@href resolves against baseUrl", async () => {
    const out = await extractSingle(doc, "//a/@href", { baseUrl: "https://ex.com/book/1.html" });
    expect(out).toBe("https://ex.com/c/1.html");
  });

  it("substring-before and substring functions", async () => {
    const out = await extractSingle(doc, "@xpath:substring-before(normalize-space(//div[@class='title']), ' ')");
    expect(out).toBe("第一章");
    const out2 = await extractSingle(doc, "substring(normalize-space(//div[@class='title']), 1, 3)");
    expect(out2).toBe("第一章");
  });

  it("count() returns the node count as string", async () => {
    const multi = parseHtml(`<html><body><ul><li>一</li><li>二</li><li>三</li></ul></body></html>`);
    const out = await extractSingle(multi, "count(//li)");
    expect(out).toBe("3");
  });

  it("position() selects the indexed node", async () => {
    const multi = parseHtml(`<html><body><ul><li>一</li><li>二</li><li>三</li></ul></body></html>`);
    const out = await extractSingle(multi, "//li[position()=2]");
    expect(out).toBe("二");
  });
});

describe("legado JSON rules: wildcard and range", () => {
  const data = {
    list: [
      { id: 1, name: "甲", tags: ["a", "b"] },
      { id: 2, name: "乙", tags: ["c"] },
      { id: 3, name: "丙", tags: [] },
    ],
  };

  it("jsonGet supports [*] wildcard returning all items", () => {
    const all = jsonGet(data, "$.list[*]");
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBe(3);
  });

  it("jsonGet supports multi-level wildcard $.list[*].name", () => {
    expect(jsonGet(data, "$.list[*].name")).toEqual(["甲", "乙", "丙"]);
  });

  it("jsonGet supports [a:b] range slice", () => {
    expect(jsonGet(data, "$.list[0:2].id")).toEqual([1, 2]);
  });

  it("jsonGet supports [?(...)] filter with comparisons", () => {
    const filtered = jsonGet(data, "$.list[?(@.id>=2)]");
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBe(2);
    expect(filtered[0].name).toBe("乙");
  });

  it("jsonGet supports [?(...)] with && combination and string compare", () => {
    const filtered = jsonGet(data, "$.list[?(@.name=='乙'&&@.id==2)]");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(2);
  });

  it("extractList works with @Json: filtered chapterList", async () => {
    const items = await extractList(emptyDoc(), "@Json:list[?(@.id>=2)]", {
      name: "$.name", url: "$.id",
    }, { result: JSON.stringify(data), sourceKey: "x" });
    expect(items).toEqual([
      { name: "乙", url: "2" },
      { name: "丙", url: "3" },
    ]);
  });

  it("extractList works with @Json: wildcard chapterList", async () => {
    const items = await extractList(emptyDoc(), "@Json:list[*]", {
      name: "$.name", url: "$.id",
    }, { result: JSON.stringify(data), sourceKey: "x" });
    expect(items).toEqual([
      { name: "甲", url: "1" },
      { name: "乙", url: "2" },
      { name: "丙", url: "3" },
    ]);
  });
});

describe("legado chain css@js: rules", () => {
  it("extractSingle css@js: passes css value as result to js", async () => {
    const doc = parseHtml(`<html><body><div class="num">21</div></body></html>`);
    const out = await extractSingle(doc, "@css:.num@js:result*2");
    expect(out).toBe("42");
  });

  it("extractSingle plain selector@js: chain", async () => {
    const doc = parseHtml(`<html><body><span class="name">  张三  </span></body></html>`);
    const out = await extractSingle(doc, ".name@js:result.trim()");
    expect(out).toBe("张三");
  });

  it("json@js: mixed rule still routes through the json branch", async () => {
    const out = await extractSingle(emptyDoc(), "@Json:data.title", {
      result: JSON.stringify({ data: { title: "斗破" } }),
    });
    expect(out).toBe("斗破");
  });
});

describe("legado selector shorthand (id./class./! index)", () => {
  const html = `<html><body>
    <table><tbody><tr><td>行1</td></tr><tr><td>行2</td></tr></tbody></table>
    <div class="grid"><div id="nr">正文内容</div><div class="item a">A</div><div class="item b">B</div></div>
  </body></html>`;
  const doc = parseHtml(html);

  it("extractSingle supports tr!0 bang index", async () => {
    const out = await extractSingle(doc, "tr!0@text");
    expect(out).toBe("行1");
  });

  it("extractList supports tbody@tr!1 bang index in chain", async () => {
    const items = await extractList(doc, "tbody@tr!1", { name: "td@text" });
    expect(items[0].name).toBe("行2");
  });

  it("extractSingle supports id.nr shorthand", async () => {
    const out = await extractSingle(doc, "id.nr");
    expect(out).toBe("正文内容");
  });

  it("extractList supports class.grid@id.nr chain", async () => {
    const items = await extractList(doc, "class.grid@id.nr", { name: "text" });
    expect(items[0].name).toBe("正文内容");
  });

  it("extractList supports class multi-class shorthand", async () => {
    const items = await extractList(doc, "class.item a", { name: "text" });
    expect(items[0].name).toBe("A");
  });
});

describe("legado regex rules (/pattern/)", () => {
  it("parseRule recognizes slashed regex rules", () => {
    expect(parseRule("/第(\\d+)章/").type).toBe("regex");
    expect(parseRule("/abc/gi").type).toBe("regex");
  });

  it("extractSingle matches /pattern/ against result, returning capture group", async () => {
    const doc = parseHtml(`<html><body>第12章 标题</body></html>`);
    const out = await extractSingle(doc, "/第(\\d+)章/", { result: "第12章 标题" });
    expect(out).toBe("12");
  });

  it("extractSingle falls back to document text when result is empty", async () => {
    const doc = parseHtml(`<html><body><div>编号：42</div></body></html>`);
    const out = await extractSingle(doc, "/编号：(\\d+)/");
    expect(out).toBe("42");
  });

  it("returns empty when no match", async () => {
    const doc = parseHtml(`<html><body>无匹配</body></html>`);
    const out = await extractSingle(doc, "/第(\\d+)章/");
    expect(out).toBe("");
  });

  it("invalid regex is swallowed", async () => {
    const doc = parseHtml(`<html><body>x</body></html>`);
    const out = await extractSingle(doc, "/(unclosed/");
    expect(out).toBe("");
  });
});

describe("legado jsoup-style node API in @js:", () => {
  const html = `<div class="list"><div class="item"><a href="/b/1.html" class="t">第一章</a><span class="tag">连载</span></div></div>`;
  const doc = parseHtml(html);

  it("node.select returns jsoup-style array with first/text", () => {
    const r = evalJs("node.select('.item a').first().text()", { doc, node: doc.querySelector(".list")!, baseUrl: "https://ex.com" });
    expect(r).toBe("第一章");
  });

  it("node.selectFirst + attr/text/html", () => {
    const r1 = evalJs("node.selectFirst('.tag').text()", { doc, node: doc.querySelector(".list")!, baseUrl: "https://ex.com" });
    expect(r1).toBe("连载");
    const r2 = evalJs("node.selectFirst('a').attr('href')", { doc, node: doc.querySelector(".list")!, baseUrl: "https://ex.com" });
    expect(r2).toBe("/b/1.html");
    const r3 = evalJs("node.selectFirst('a').html()", { doc, node: doc.querySelector(".list")!, baseUrl: "https://ex.com" });
    expect(r3).toBe("第一章");
  });

  it("node.children/parents/first/size work", () => {
    const r = evalJs("node.children().size() + ':' + node.children().first().text()", { doc, node: doc.querySelector(".list")!, baseUrl: "https://ex.com" });
    expect(r).toBe("1:第一章连载");
  });

  it("doc.select works on the document", () => {
    expect(evalJs("doc.select('.item a').size()", { doc, baseUrl: "https://ex.com" })).toBe(1);
    expect(evalJs("doc.selectFirst('.tag').text()", { doc, baseUrl: "https://ex.com" })).toBe("连载");
  });

  it("java.toString / toJSONString / md5Encode16", () => {
    expect(evalJs("java.toString(123)", { doc: emptyDoc() })).toBe("123");
    expect(evalJs("java.toJSONString({a:1})", { doc: emptyDoc() })).toBe('{"a":1}');
    expect(evalJs("java.md5Encode16('abc')", { doc: emptyDoc() })).toBe(md5("abc").slice(8, 24));
  });

  it("java byte-level helpers roundtrip", () => {
    // base64 → 字节数组 → 字符串
    expect(evalJs("java.byteArrayToString(java.base64DecodeToByteArray('5L2g5aW9'))", { doc: emptyDoc() })).toBe("你好");
    expect(evalJs("java.byteArrayToString(java.stringToByteArray('你好'))", { doc: emptyDoc() })).toBe("你好");
    expect(evalJs("java.getByteLength('你好')", { doc: emptyDoc() })).toBe(6);
  });

  it("extractList item rule @js: uses the current node", async () => {
    const items = await extractList(doc, ".item", {
      name: "@js:node.select('a').first().text()",
      url: "@js:'https://ex.com' + node.selectFirst('a').attr('href')",
    }, { baseUrl: "https://ex.com" });
    expect(items[0]).toEqual({ name: "第一章", url: "https://ex.com/b/1.html" });
  });
});
