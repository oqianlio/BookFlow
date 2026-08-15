import { md5 } from "./md5";
import { SymmetricCrypto } from "./aes";
import { getSourceVars } from "./sourceVars";
import { getJsLib } from "./jsLib";
import { httpGet, mergeUserAgent } from "./api";

export type EngineResult = string;

export type ParsedRule = {
  type: "css" | "regex" | "regexReplace" | "js" | "xpath" | "json" | "plain" | "jsBlock";
  value: string;
  attr?: string;
  after?: string;
};

export interface BookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceType?: number;
  enabled?: boolean;
  httpUserAgent?: string;
  httpHeaders?: Record<string, string>;
  searchUrl?: string;
  exploreUrl?: string;
  loginUrl?: string;
  jsLib?: string;
  ruleExplore?: any;
  bookUrlPattern?: string;
  ruleSearch?: any;
  ruleBookInfo?: any;
  ruleToc?: any;
  ruleContent?: any;
}

const REMOVE_SELECTORS = ["script", "style", "ins", "iframe", "noscript", "button", "footer", ".ad", ".ads", ".advert", "#ad"];

export function purifyContent(html: string, replaceRules?: string[]): string {
  const doc = new DOMParser().parseFromString(`<div id="__purify__">${html}</div>`, "text/html");
  const root = doc.getElementById("__purify__")!;
  for (const sel of REMOVE_SELECTORS) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  let out = (root.innerHTML ?? "").trim();
  if (replaceRules) {
    for (const rule of replaceRules) {
      if (rule.startsWith("##")) {
        const parts = rule.slice(2).split("##");
        if (!parts[0]) continue;
        try {
          out = out.replace(new RegExp(parts[0], "g"), parts[1] ?? "");
        } catch {
          continue;
        }
      }
    }
  }
  return out;
}

export function parseBookSourceJson(raw: string): BookSource {
  const obj = JSON.parse(raw);
  if (!obj.bookSourceUrl || !obj.bookSourceName) {
    throw new Error("书源缺少 bookSourceUrl 或 bookSourceName");
  }
  return obj as BookSource;
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function jsonGet(obj: any, path: string): any {
  if (obj == null) return undefined;
  let cur: any = obj;
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);
  if (!p) return cur;
  const tokens = p.match(/[^.[\]]+|\d+(?=\])/g) ?? [];
  for (const tok of tokens) {
    if (cur == null) return undefined;
    cur = cur[tok];
  }
  return cur;
}

export function parseRule(rule: string): ParsedRule {
  const s = rule.trim();
  if (s.startsWith("@css:")) {
    return parseAttrRule(s.slice(5));
  }
  if (s.startsWith("@xpath:")) {
    return { type: "xpath", value: s.slice(7) };
  }
  if (s.startsWith("@js:")) {
    return { type: "js", value: s.slice(4) };
  }
  if (s.startsWith("<js>")) {
    const end = s.indexOf("</js>");
    if (end !== -1) {
      return { type: "jsBlock", value: s.slice(4, end), after: s.slice(end + 5).trim() };
    }
  }
  if (s.startsWith("@Json:")) {
    return { type: "json", value: s.slice(6).trim() };
  }
  if (s.startsWith("$.") || s.startsWith("$[")) {
    return { type: "json", value: s };
  }
  if (s.startsWith("##")) {
    return { type: "regexReplace", value: s.slice(2) };
  }
  if (s.includes("{{")) {
    return { type: "regex", value: s };
  }
  return parseAttrRule(s);
}

function parseAttrRule(s: string): ParsedRule {
  if (s.startsWith("@")) {
    // 纯属性后缀（如 "@text"/"@href"）：表示对当前节点自身取值
    return { type: "css", value: "", attr: s.slice(1) };
  }
  const m = s.match(/^(.+?)@([a-zA-Z]+)$/);
  if (m) {
    return { type: "css", value: m[1], attr: m[2] };
  }
  return { type: "css", value: s, attr: "text" };
}

export function selectNodes(doc: Document, selector: string): Element[] {
  if (!selector.trim()) return [];
  return Array.from(doc.querySelectorAll(selector));
}

const ABS_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveUrl(href: string, baseUrl: string): string {
  if (ABS_URL_RE.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function isUrlField(path: string): boolean {
  return path.endsWith("bookUrl") || path.endsWith("coverUrl") || path.endsWith("thumb_url") || path.endsWith("cover_url") || path.endsWith("tocUrl") || path.endsWith("toc_url");
}

export function nodeValue(node: Element, attr?: string): string {
  const a = attr ?? "text";
  switch (a) {
    case "text":
      return (node.textContent ?? "").trim();
    case "ownText": {
      let out = "";
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.textContent;
      }
      return out.trim();
    }
    case "all":
      return (node.textContent ?? "").trim();
    case "textNodes": {
      // legado 的 @textNodes：收集所有后代文本节点并拼接（常用于正文提取）
      let out = "";
      const walker = (n: Node) => {
        for (const child of n.childNodes) {
          if (child.nodeType === 3) {
            out += (child.textContent ?? "") + "\n";
          } else {
            walker(child);
          }
        }
      };
      walker(node);
      return out.trim();
    }
    case "html":
      return (node as HTMLElement).innerHTML?.trim() ?? "";
    case "href":
      return node.getAttribute("href") ?? "";
    case "src":
      return node.getAttribute("src") ?? "";
    default:
      return node.getAttribute(a) ?? (node.textContent ?? "").trim();
  }
}

export function splitAlternatives(rule: string): string[] {
  return rule.split("||").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function resolveTagIndex(selector: string, scope: Document | Element): Element | null {
  const m = selector.match(/^tag\.([a-zA-Z][\w-]*)\.(\d+)$/);
  if (!m) return null;
  const tag = m[1];
  const index = parseInt(m[2], 10);
  const nodes = scope.querySelectorAll(tag);
  return nodes[index] ?? null;
}

export interface ExtractContext {
  doc?: Document;
  baseUrl?: string;
  result?: unknown;
  sourceKey?: string;
  source?: any;
  cookieHost?: string;
}

export async function extractSingle(doc: Document, rule: string, ctx?: ExtractContext): Promise<string> {
  const alts = splitAlternatives(rule);
  if (alts.length > 1) {
    for (const alt of alts) {
      const v = await extractSingle(doc, alt, ctx);
      if (v) return v;
    }
    return "";
  }
  const parsed = parseRule(rule);
  if (parsed.type === "regex") {
    const m = rule.match(/{{(.*?)}}/);
    if (m) {
      const re = new RegExp(m[1]);
      const hit = re.exec(doc.body?.textContent ?? "");
      return hit ? (hit[1] ?? hit[0]) : "";
    }
    return "";
  }
  if (parsed.type === "regexReplace") {
    const parts = rule.slice(2).split("##");
    const re = new RegExp(parts[0], "g");
    return (doc.body?.textContent ?? "").replace(re, parts[1] ?? "");
  }
  if (parsed.type === "xpath") {
    const result = doc.evaluate(parsed.value, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue as Element | null;
    return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
  }
  if (parsed.type === "js") {
    return evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey });
  }
  if (parsed.type === "json") {
    let j: any;
    try { j = JSON.parse(String(ctx?.result ?? "")); } catch { return ""; }
    const jsIdx = parsed.value.indexOf("@js:");
    const pathPart = (jsIdx > 0 ? parsed.value.slice(0, jsIdx) : parsed.value).trim();
    const v = jsonGet(j, pathPart);
    if (v == null) return "";
    if (jsIdx > 0) {
      return String(evalJs(parsed.value.slice(jsIdx + 4), { doc, baseUrl: ctx?.baseUrl, result: v, sourceKey: ctx?.sourceKey }) ?? "");
    }
    const str = String(v);
    if (str && isUrlField(pathPart) && ctx?.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(str)) return resolveUrl(str, ctx.baseUrl);
    return str;
  }
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source };
    evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as any)._ajaxUrl as string | undefined;
    let doc = ctx?.doc ?? emptyDoc();
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const host = ctx?.cookieHost ?? "";
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, host);
      doc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractSingle(doc, parsed.after ?? "", newCtx);
  }
  if (!parsed.value) return "";
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, doc);
    return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
  }
  const node = doc.querySelector(parsed.value);
  return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
}

function finalize(v: string, attr?: string, baseUrl?: string): string {
  if (!v) return "";
  if (attr === "href" || attr === "src") return baseUrl ? resolveUrl(v, baseUrl) : v;
  return v;
}

export async function extractList(
  doc: Document,
  listRule: string,
  itemRules: Record<string, string>,
  ctx?: ExtractContext,
): Promise<Array<Record<string, string>>> {
  const parsed = parseRule(listRule);
  if (parsed.type === "xpath") {
    const nodes = doc.evaluate(parsed.value, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const arr: Element[] = [];
    for (let i = 0; i < nodes.snapshotLength; i++) {
      const n = nodes.snapshotItem(i) as Element | null;
      if (n) arr.push(n);
    }
    return arr.map((node) => {
      const out: Record<string, string> = {};
      for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule);
      return out;
    });
  }
  if (parsed.type === "js") {
    const raw = evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey });
    let items: any[];
    try {
      items = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    } catch {
      items = [];
    }
    return (items as any[]).map((item) => {
      const out: Record<string, string> = {};
      for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromJsObject(item, rule, ctx?.baseUrl, ctx?.sourceKey);
      return out;
    });
  }
  if (parsed.type === "json") {
    let j: any;
    try { j = JSON.parse(String(ctx?.result ?? "")); } catch { return []; }
    const jsIdx = parsed.value.indexOf("@js:");
    const pathPart = (jsIdx > 0 ? parsed.value.slice(0, jsIdx) : parsed.value).trim();
    let arr = jsonGet(j, pathPart);
    if (jsIdx > 0) {
      const raw = evalJs(parsed.value.slice(jsIdx + 4), { doc, baseUrl: ctx?.baseUrl, result: arr ?? "", sourceKey: ctx?.sourceKey });
      try { arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]")); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      const out: Record<string, string> = {};
      for (const [key, rule] of Object.entries(itemRules)) {
        out[key] = extractFromJsonObject(item, rule, { baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey });
      }
      return out;
    });
  }
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source };
    evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as any)._ajaxUrl as string | undefined;
    let doc = ctx?.doc ?? emptyDoc();
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, ctx?.cookieHost ?? "");
      doc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractList(doc, parsed.after ?? "", itemRules, newCtx);
  }
  if (parsed.type !== "css") return [];
  const nodes = selectNodes(doc, parsed.value);
  return nodes.map((node) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) {
      out[key] = extractFromElement(node, rule, ctx?.baseUrl);
    }
    return out;
  });
}

export function extractFromJsObject(obj: any, rule: string, baseUrl?: string, sourceKey?: string): string {
  return extractFromJsonObject(obj, rule, { baseUrl, sourceKey });
}

export function extractFromJsonObject(
  obj: any,
  rule: string,
  ctx?: { baseUrl?: string; sourceKey?: string },
): string {
  if (obj == null || typeof obj !== "object") return "";
  const s = rule.trim();
  if (!s) return "";
  const jsIdx = s.indexOf("@js:");
  if (jsIdx === 0) {
    return String(evalJs(s.slice(4), { doc: emptyDoc(), result: obj, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey }) ?? "");
  }
  const pathPart = (jsIdx > 0 ? s.slice(0, jsIdx) : s).trim();
  const path = pathPart.startsWith("@Json:")
    ? pathPart.slice(6).trim()
    : pathPart.replace(/^\$\.?/, "");
  const v = jsonGet(obj, path);
  if (jsIdx > 0) {
    return String(evalJs(s.slice(jsIdx + 4), { doc: emptyDoc(), result: v, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey }) ?? "");
  }
  if (v == null) return "";
  const str = String(v);
  if (str && isUrlField(path) && ctx?.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(str)) return resolveUrl(str, ctx.baseUrl);
  return str;
}

function extractFromElement(el: Element, rule: string, baseUrl?: string): string {
  const alts = splitAlternatives(rule);
  if (alts.length > 1) {
    for (const alt of alts) {
      const v = extractFromElement(el, alt, baseUrl);
      if (v) return v;
    }
    return "";
  }
  const parsed = parseRule(rule);
  if (parsed.type !== "css") return "";
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取当前节点自身
    return finalize(nodeValue(el, parsed.attr), parsed.attr, baseUrl);
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, el);
    return node ? finalize(nodeValue(node, parsed.attr), parsed.attr, baseUrl) : "";
  }
  const node = el.matches(parsed.value) ? el : el.querySelector(parsed.value);
  return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, baseUrl) : "";
}

export function emptyDoc(): Document {
  return new DOMParser().parseFromString("", "text/html");
}

export interface JsContext {
  node?: Element;
  doc: Document;
  result?: unknown;
  baseUrl?: string;
  key?: string;
  page?: number;
  source?: any;
  sourceKey?: string;
  cookieHost?: string;
}

export function evalJs(expr: string, ctx: JsContext): any {
  const vars = getSourceVars(ctx.sourceKey ?? "default");
  const java = {
    encodeURI: (s: string) => encodeURIComponent(String(s)),
    decodeURI: (s: string) => decodeURIComponent(String(s)),
    base64Decode: (b64: string) =>
      new TextDecoder("utf-8").decode(Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0))),
    base64Encode: (s: string) => {
      const bytes = new TextEncoder().encode(String(s));
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    },
    regex: (input: string, pattern: string) => {
      const m = String(input).match(new RegExp(pattern));
      return m ? (m[1] ?? m[0]) : "";
    },
    md5: (s: string) => md5(String(s)),
    md5Encode: (s: string) => md5(String(s)),
    random: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    createSymmetricCrypto: (transformation: string, key: any, iv?: any) =>
      new SymmetricCrypto(transformation, key, iv),
    put: (k: string, v: any) => { const s = v == null ? "" : String(v); vars.set(String(k), s); return s; },
    get: (k: string) => vars.get(String(k)) ?? "",
    ajax: (url: any) => { (ctx as any)._ajaxUrl = String(url ?? ""); return ""; },
  };
  const source = ctx.source ?? {};
  // 自定义 source 方法优先；未提供时才注入会话变量兜底（get/put/set 三者对称）
  if (!source.getVariable) source.getVariable = () => String(vars.get("variable") ?? "");
  if (!source.putVariable) source.putVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
  if (!source.setVariable) source.setVariable = (v: any) => { vars.set("variable", String(v)); return ""; };
  // legado 的 TYPE()：从 source 变量读取当前分类索引并映射到 tab_type 值（默认小说=3）
  const TYPE = () => {
    const v = String(source.getVariable?.() ?? "").split(",")[0];
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 0 && n < 4) return [3, 2, 8, 11][n];
    return 3;
  };
  const code = String(expr).trim();
  let body: string;
  if (/\breturn\b/.test(code)) {
    // 显式 return 语句
    body = code;
  } else {
    // 取末尾独立语句作为返回表达式：优先按换行，其次按分号切分的最后一段
    const lastLine = code.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0).pop() ?? "";
    const segments = lastLine.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    const last = segments[segments.length - 1] ?? lastLine;
    const lastIsDecl = /\b(var|let|const|if|for|while|function|return)\b/.test(last) || last.endsWith("}") || last.startsWith("}");
    if (last && !lastIsDecl) {
      body = `${code}\nreturn (${last.replace(/;\s*$/, "")});`;
    } else {
      body = `${code}\nreturn result;`;
    }
  }
  // 读取 jsLib 代码并前缀注入（非严格模式：jsLib 内定义的函数调用时 this 指向全局，
  // 通过临时挂载 globalThis.source 让书源里 this.source 约定可用）
  const jsLibCode = ctx.sourceKey ? getJsLib(ctx.sourceKey) : "";
  if (jsLibCode) {
    body = `${jsLibCode}\n${body}`;
  }
  const fn = new Function(
    "node", "doc", "result", "baseUrl", "key", "page", "source", "java", "url", "TYPE",
    body,
  );
  try {
    const g = globalThis as Record<string, unknown>;
    const prevSource = g.__ydSource;
    g.__ydSource = source;
    const prevThisSource = (g as Record<string, unknown>).source;
    (g as Record<string, unknown>).source = source;
    try {
      return fn.call({ source }, ctx.node ?? null, ctx.doc, ctx.result ?? "", ctx.baseUrl ?? "", ctx.key ?? "", ctx.page ?? 1, source, java, ctx.baseUrl ?? "", TYPE);
    } finally {
      (g as Record<string, unknown>).source = prevThisSource;
      g.__ydSource = prevSource;
    }
  } catch (e) {
    console.warn("evalJs error:", expr, e);
    return "";
  }
}

export function parseSearchUrl(searchUrl: string, key: string): { url: string; method?: string; body?: string } {
  const commaIdx = searchUrl.indexOf(",{");
  if (commaIdx === -1) {
    return { url: searchUrl.replace("{{key}}", encodeURIComponent(key)) };
  }
  const url = searchUrl.slice(0, commaIdx);
  try {
    const opts = JSON.parse(searchUrl.slice(commaIdx + 1));
    const body = (opts.body ?? "").replace("{{key}}", encodeURIComponent(key));
    return { url, method: opts.method ?? "POST", body };
  } catch {
    return { url: searchUrl.replace("{{key}}", encodeURIComponent(key)) };
  }
}

export function resolveSearchUrl(searchUrl: string, key: string, page: number, ctx?: { sourceKey?: string }): { url: string; method?: string; body?: string } {
  const s = searchUrl.trim();
  if (s.startsWith("@js:")) {
    const url = String(evalJs(s.slice(4), { doc: emptyDoc(), key, page, result: "", sourceKey: ctx?.sourceKey }) ?? "");
    return { url };
  }
  return parseSearchUrl(s, key);
}

export function parseExploreUrl(
  exploreUrl: string,
  ctx?: { sourceKey?: string; source?: any },
): Array<{ title: string; url: string }> {
  const s = exploreUrl.trim();
  if (s.startsWith("@js:")) {
    const expr = s.slice(4);
    const raw = evalJs(expr, {
      doc: emptyDoc(),
      result: "",
      sourceKey: ctx?.sourceKey,
      source: ctx?.source,
    });
    // 表达式直接返回对象数组（如 @js:[{...},{...}]）
    if (Array.isArray(raw)) {
      return raw
        .map((item) => ({
          title: String(item?.title ?? item?.name ?? ""),
          url: String(item?.url ?? ""),
        }))
        .filter((k) => k.url);
    }
    const str = String(raw ?? "").trim();
    if (!str) return [];
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            title: String(item?.title ?? item?.name ?? ""),
            url: String(item?.url ?? ""),
          }))
          .filter((k) => k.url);
      }
    } catch {
      // 非 JSON，走字符串解析
    }
    return str
      .split(/(?:&&|\n)+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf("::");
        if (idx === -1) return { title: line, url: line };
        return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
      });
  }
  return exploreUrl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("::");
      if (idx === -1) return { title: line, url: line };
      return { title: line.slice(0, idx).trim(), url: line.slice(idx + 2).trim() };
    });
}

export async function extractBookList(
  doc: Document,
  rules: Record<string, string>,
  ctx: ExtractContext,
): Promise<Array<Record<string, string>>> {
  const itemRules: Record<string, string> = {};
  for (const k of ["name", "author", "coverUrl", "bookUrl"] as const) {
    if (rules[k]) itemRules[k] = rules[k];
  }
  return await extractList(doc, rules.bookList ?? "", itemRules, { baseUrl: ctx.baseUrl, result: ctx.result, sourceKey: ctx.sourceKey, source: ctx.source, cookieHost: ctx.cookieHost });
}

export function isImageChapter(html: string): boolean {
  return /<\s*img\b/i.test(html);
}

export function extractImageUrls(html: string, baseUrl: string): string[] {
  const doc = parseHtml(html);
  const urls: string[] = [];
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (src) urls.push(resolveUrl(src, baseUrl));
  });
  return urls;
}
