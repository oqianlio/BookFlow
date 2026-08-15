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
  replace?: Array<[string, string]>;
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

/** 从书源地址提取 host（cookie jar 键），URL 非法时原样返回 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

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

export function parseBookSourceJson(raw: string): BookSource {  const obj = JSON.parse(raw);
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
  if (s.toLowerCase().startsWith("@xpath:")) {
    return { type: "xpath", value: s.slice(7) };
  }
  // 裸 XPath（legado 常直接写 // 开头，无前缀）
  if (s.startsWith("//") || s.startsWith("(//")) {
    return { type: "xpath", value: s };
  }
  if (s.startsWith("@css:")) {
    return parseAttrRule(s.slice(5));
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
  // legado 正则规则：/pattern/ 或 /pattern/flag（斜杠包裹）；css 选择器不会以 / 开头
  if (s.startsWith("/") && /^\/.+\/[a-z]*$/.test(s)) {
    return { type: "regex", value: s };
  }
  return parseAttrRule(s);
}

/** 拆分 legado `##正则##替换` 链式替换后缀（返回提取规则体 + 替换对列表） */
function splitReplaceSuffix(s: string): { body: string; replaces: Array<[string, string]> } {
  const trimmed = s.trim();
  if (!trimmed.includes("##")) return { body: trimmed, replaces: [] };
  const parts = trimmed.split("##");
  if (parts.length < 3) return { body: trimmed, replaces: [] };
  const body = parts[0].trim();
  const replaces: Array<[string, string]> = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    replaces.push([parts[i], parts[i + 1]]);
  }
  return { body, replaces };
}

function parseAttrRule(s: string): ParsedRule {
  const { body, replaces } = splitReplaceSuffix(s);
  const replace = replaces.length ? replaces : undefined;
  if (body.startsWith("@")) {
    // 纯属性后缀（如 "@text"/"@href"）：表示对当前节点自身取值
    return { type: "css", value: "", attr: body.slice(1), replace };
  }
  // legado 纯属性名（text/href/src/html 等）：对当前节点自身取值
  if (["text", "ownText", "all", "textNodes", "html", "href", "src"].includes(body)) {
    return { type: "css", value: "", attr: body, replace };
  }
  const m = body.match(/^(.+?)@([a-zA-Z]+)$/);
  if (m) {
    return { type: "css", value: m[1], attr: m[2], replace };
  }
  return { type: "css", value: body, attr: "text", replace };
}

export function selectNodes(doc: Document, selector: string): Element[] {
  if (!selector.trim()) return [];
  return Array.from(doc.querySelectorAll(selector));
}

/** 安全选择：常规 querySelectorAll，失败（非法选择器）则回退 queryIndexed 单节点 */
function selectNodesSafe(selector: string, scope: Document | Element): Element[] {
  try {
    return Array.from(scope.querySelectorAll(selector));
  } catch {
    const hit = queryIndexed(selector, scope);
    return hit ? [hit] : [];
  }
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
    // 匹配源字符串：优先 result（ajax/json 原始内容），否则文档文本
    const source = String(ctx?.result ?? "") || (doc.body?.textContent ?? "");
    const slashed = rule.match(/^\/(.*?)\/([a-z]*)$/);
    if (slashed) {
      try {
        const hit = new RegExp(slashed[1], slashed[2]).exec(source);
        return hit ? (hit[1] ?? hit[0]) : "";
      } catch {
        return "";
      }
    }
    const m = rule.match(/{{(.*?)}}/);
    if (m) {
      try {
        const re = new RegExp(m[1]);
        const hit = re.exec(source);
        return hit ? (hit[1] ?? hit[0]) : "";
      } catch {
        return "";
      }
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
    let jsDoc = ctx?.doc ?? doc;
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const host = ctx?.cookieHost ?? "";
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, host);
      jsDoc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractSingle(jsDoc, parsed.after ?? "", newCtx);
  }
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取文档自身（extractSingle 场景少见，返回空）
    return "";
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, doc);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
  }
  const node = queryIndexed(parsed.value, doc);
  return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
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
  // 链式元素规则（legado A@B@C）：含 @ 且非已知前缀（@xpath/@js/json/纯属性）
  const trimmedList = listRule.trim();
  const looksChain = trimmedList.includes("@")
    && !trimmedList.startsWith("@")
    && !trimmedList.startsWith("//")
    && !trimmedList.startsWith("$");
  if (looksChain) {
    const chain = trimmedList.split("@").map((s) => s.trim()).filter(Boolean);
    if (chain.length > 1) {
      // 链式 A@B@C：A 选根节点（支持 .class.N 索引取单个），B/C 在节点内取全部匹配
      let nodes: Element[] = selectNodesSafe(chain[0], doc);
      for (let i = 1; i < chain.length && nodes.length > 0; i++) {
        const next: Element[] = [];
        for (const n of nodes) {
          // 段含类索引（如 .clearfix.1）→ 取指定第 N 个；否则取全部匹配
          if (/\.\d+$/.test(chain[i])) {
            const hit = queryIndexed(chain[i], n);
            if (hit) next.push(hit);
          } else {
            try {
              next.push(...Array.from(n.querySelectorAll(chain[i])));
            } catch {
              // 非法选择器回退
              const hit = queryIndexed(chain[i], n);
              if (hit) next.push(hit);
            }
          }
        }
        nodes = next;
      }
      return nodes.map((node) => {
        const out: Record<string, string> = {};
        for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule, ctx?.baseUrl);
        return out;
      });
    }
  }
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
      for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromElement(node, rule, ctx?.baseUrl);
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
    let jsDoc = ctx?.doc ?? doc;
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, ctx?.cookieHost ?? "");
      jsDoc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    return extractList(jsDoc, parsed.after ?? "", itemRules, newCtx);
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
  if (parsed.type === "xpath") {
    // item 规则内 XPath（如 @XPath:.//a/text() 或 .//a/@href）：相对当前节点求值
    try {
      const sv = el.ownerDocument!.evaluate(parsed.value, el, null, XPathResult.STRING_TYPE, null);
      const str = (sv.stringValue ?? "").trim();
      if (str) {
        // @href/@src 结尾 → 解析相对 URL
        const isUrl = parsed.value.endsWith("/@href") || parsed.value.endsWith("/@src");
        return finalize(applyReplacements(str, parsed.replace), isUrl ? "href" : "text", baseUrl);
      }
      const result = el.ownerDocument!.evaluate(parsed.value, el, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const node = result.singleNodeValue as Element | null;
      if (node) return finalize(applyReplacements(nodeValue(node, "text"), parsed.replace), "text", baseUrl);
      return "";
    } catch {
      return "";
    }
  }
  if (parsed.type === "js") {
    // item 规则 @js:：node = 当前列表项元素（jsoup 风格包装），支持 node.select/selectFirst/attr/text 等
    try {
      return String(evalJs(parsed.value, { doc: el.ownerDocument ?? emptyDoc(), node: el, result: "", baseUrl }) ?? "");
    } catch {
      return "";
    }
  }
  if (parsed.type !== "css") return "";
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取当前节点自身
    return finalize(applyReplacements(nodeValue(el, parsed.attr), parsed.replace), parsed.attr, baseUrl);
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, el);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
  }
  const node = queryIndexed(parsed.value, el);
  return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
}

/** 应用 legado `##正则##替换` 链式替换；非法正则跳过（保留原值） */
function applyReplacements(v: string, replaces?: Array<[string, string]>): string {
  if (!replaces || !v) return v;
  let out = v;
  for (const [re, rep] of replaces) {
    if (!re) continue;
    try { out = out.replace(new RegExp(re, "g"), rep ?? ""); } catch { /* 非法正则保留原值 */ }
  }
  return out;
}

/**
 * 在 scope 内查找选择器命中节点；支持 legado `.class.N` 语法（取第 N 个匹配）。
 * 先尝试常规 querySelector；失败（非法选择器）或带数字后缀时，按 base 选择器 + index 取。
 */
function queryIndexed(selector: string, scope: Document | Element): Element | null {
  try {
    return scope.querySelector(selector);
  } catch {
    // 非法选择器（如 .author.0）→ 尝试拆分 .数字 后缀
  }
  const m = selector.match(/^(.+?)\.(\d+)$/);
  if (!m) return null;
  const base = m[1];
  const index = parseInt(m[2], 10);
  let nodes: NodeListOf<Element>;
  try {
    nodes = scope.querySelectorAll(base);
  } catch {
    return null;
  }
  return nodes[index] ?? null;
}

export function emptyDoc(): Document {
  return new DOMParser().parseFromString("", "text/html");
}

// ============ legado/jsoup 风格节点 API ============
// 大量 legado 书源在 @js: 规则里使用 jsoup 方法（node.select/selectFirst/attr/text/children 等），
// 裸 Element 不具备这些方法导致规则失败。这里给节点附加 jsoup 风格方法（实例级，不污染原型）。
type JNode = Element & Record<string, any>;

/** 实例属性遮蔽：children/body 等只读访问器需 defineProperty 才能覆盖 */
function def(o: any, k: string, v: any): void {
  Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
}

function jArr(arr: Element[]): any[] {
  const a: any = arr;
  def(a, "first", () => (arr[0] ? jsoupNode(arr[0]) : null));
  def(a, "last", () => (arr[arr.length - 1] ? jsoupNode(arr[arr.length - 1]) : null));
  def(a, "size", () => arr.length);
  def(a, "get", (i: number) => (arr[i] ? jsoupNode(arr[i]) : null));
  def(a, "text", () => arr.map((n) => (n.textContent ?? "")).join("").trim());
  def(a, "attr", (k: string) => arr[0]?.getAttribute(k) ?? "");
  def(a, "html", () => arr.map((n) => n.innerHTML).join(""));
  return a;
}

function jsoupNode(n: Element): JNode {
  const o = n as JNode;
  if (o.__jsoup) return o;
  def(o, "__jsoup", true);
  const origChildren = n.children; // 缓存：children 属性会被下方方法覆盖
  def(o, "select", (sel: string) => jArr(Array.from(n.querySelectorAll(sel))));
  def(o, "selectFirst", (sel: string) => { const e = n.querySelector(sel); return e ? jsoupNode(e) : null; });
  def(o, "attr", (k: string) => n.getAttribute(k) ?? "");
  def(o, "text", () => (n.textContent ?? "").trim());
  def(o, "ownText", () => {
    let s = "";
    for (const c of n.childNodes) if (c.nodeType === 3) s += c.textContent;
    return s.trim();
  });
  def(o, "html", () => n.innerHTML);
  def(o, "outerHtml", () => n.outerHTML);
  def(o, "children", () => jArr(Array.from(origChildren)));
  def(o, "parent", () => (n.parentElement ? jsoupNode(n.parentElement) : null));
  def(o, "parents", () => {
    const out: Element[] = [];
    let p = n.parentElement;
    while (p) { out.push(p); p = p.parentElement; }
    return jArr(out);
  });
  def(o, "first", () => o);
  def(o, "last", () => o);
  def(o, "indexOf", () => {
    let i = 0;
    let sib = n.previousElementSibling;
    while (sib) { i++; sib = sib.previousElementSibling; }
    return i;
  });
  return o;
}

function jsoupDoc(doc: Document): Document & Record<string, any> {
  const o = doc as Document & Record<string, any>;
  if (o.__jsoup) return o;
  def(o, "__jsoup", true);
  def(o, "select", (sel: string) => jArr(Array.from(doc.querySelectorAll(sel))));
  def(o, "selectFirst", (sel: string) => { const e = doc.querySelector(sel); return e ? jsoupNode(e) : null; });
  def(o, "text", () => doc.body?.textContent?.trim() ?? "");
  def(o, "html", () => doc.body?.innerHTML ?? "");
  def(o, "body", () => (doc.body ? jsoupNode(doc.body) : null));
  return o;
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
    md5Encode16: (s: string) => md5(String(s)).slice(8, 24),
    random: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    createSymmetricCrypto: (transformation: string, key: any, iv?: any) =>
      new SymmetricCrypto(transformation, key, iv),
    put: (k: string, v: any) => { const s = v == null ? "" : String(v); vars.set(String(k), s); return s; },
    get: (k: string) => vars.get(String(k)) ?? "",
    ajax: (url: any) => { (ctx as any)._ajaxUrl = String(url ?? ""); return ""; },
    toString: (x: any) => String(x ?? ""),
    toJSONString: (x: any) => {
      try { return JSON.stringify(x); } catch { return String(x ?? ""); }
    },
    stringToBase64: (s: string) => {
      const bytes = new TextEncoder().encode(String(s));
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    },
    base64ToString: (b64: string) =>
      new TextDecoder("utf-8").decode(Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0))),
    guid: () => {
      const c = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
      return `${c()}${c()}-${c()}-${c()}-${c()}-${c()}${c()}${c()}`;
    },
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
  try {
    // new Function 构造时即解析语法：须在 try 内，否则书源 @js: 表达式的语法错误会冒泡导致整条规则失败
    const fn = new Function(
      "node", "doc", "result", "baseUrl", "key", "page", "source", "java", "url", "TYPE",
      body,
    );
    const g = globalThis as Record<string, unknown>;
    const prevSource = g.__ydSource;
    g.__ydSource = source;
    const prevThisSource = (g as Record<string, unknown>).source;
    (g as Record<string, unknown>).source = source;
    try {
      // node/doc 传入 jsoup 风格包装（附加 select/selectFirst/attr/text 等方法），兼容 legado @js: 书源
      return fn.call(
        { source },
        ctx.node ? jsoupNode(ctx.node) : null,
        jsoupDoc(ctx.doc),
        ctx.result ?? "", ctx.baseUrl ?? "", ctx.key ?? "", ctx.page ?? 1,
        source, java, ctx.baseUrl ?? "", TYPE,
      );
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

function parseJsonExplore(raw: unknown): Array<{ title: string; url: string }> | null {
  let arr: unknown[] | null = null;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === "string") {
    const str = raw.trim();
    if (!str) return null;
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      return null;
    }
  }
  if (!arr) return null;
  return arr
    .map((item) => ({
      title: String((item as any)?.title ?? (item as any)?.name ?? ""),
      url: String((item as any)?.url ?? ""),
    }))
    .filter((k) => k.url);
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
    const json = parseJsonExplore(raw);
    if (json) return json;
    const str = String(raw ?? "").trim();
    if (!str) return [];
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
  // legado 原版支持 exploreUrl 直接为 JSON 数组（无需 @js 前缀）
  const json = parseJsonExplore(s);
  if (json) return json;
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
