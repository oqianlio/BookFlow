import { JSDOM } from "jsdom";

export type EngineResult = string;

export type ParsedRule = {
  type: "css" | "regex" | "regexReplace" | "js" | "xpath" | "plain";
  value: string;
  attr?: string;
};

export interface BookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceType?: number;
  enabled?: boolean;
  httpUserAgent?: string;
  httpHeaders?: Record<string, string>;
  searchUrl?: string;
  bookUrlPattern?: string;
  ruleSearch?: any;
  ruleBookInfo?: any;
  ruleToc?: any;
  ruleContent?: any;
}

const REMOVE_SELECTORS = ["script", "style", "ins", "iframe", "noscript", "button", "footer", ".ad", ".ads", ".advert", "#ad"];

export function purifyContent(html: string, replaceRules?: string[]): string {
  const doc = new JSDOM(`<div id="__purify__">${html}</div>`).window.document;
  const root = doc.getElementById("__purify__")!;
  for (const sel of REMOVE_SELECTORS) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  let out = (root.innerHTML ?? "").trim();
  if (replaceRules) {
    for (const rule of replaceRules) {
      if (rule.startsWith("##")) {
        const parts = rule.slice(2).split("##");
        out = out.replace(new RegExp(parts[0], "g"), parts[1] ?? "");
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
  const dom = new JSDOM(html);
  return dom.window.document;
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
  if (s.startsWith("##")) {
    return { type: "regexReplace", value: s.slice(2) };
  }
  if (s.includes("{{")) {
    return { type: "regex", value: s };
  }
  return parseAttrRule(s);
}

function parseAttrRule(s: string): ParsedRule {
  const m = s.match(/^(.+?)@([a-zA-Z]+)$/);
  if (m) {
    return { type: "css", value: m[1], attr: m[2] };
  }
  return { type: "css", value: s, attr: "text" };
}

export function selectNodes(doc: Document, selector: string): Element[] {
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
    case "href":
      return node.getAttribute("href") ?? "";
    case "src":
      return node.getAttribute("src") ?? "";
    default:
      return node.getAttribute(a) ?? (node.textContent ?? "").trim();
  }
}

export function extractSingle(doc: Document, rule: string, ctx?: { baseUrl?: string }): string {
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
    return evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl });
  }
  const node = doc.querySelector(parsed.value);
  return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, ctx?.baseUrl) : "";
}

function finalize(v: string, attr?: string, baseUrl?: string): string {
  if (!v) return "";
  if (attr === "href" || attr === "src") return baseUrl ? resolveUrl(v, baseUrl) : v;
  return v;
}

export function extractList(
  doc: Document,
  listRule: string,
  itemRules: Record<string, string>,
  ctx?: { baseUrl?: string },
): Array<Record<string, string>> {
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

function extractFromElement(el: Element, rule: string, baseUrl?: string): string {
  const parsed = parseRule(rule);
  if (parsed.type !== "css") return "";
  const node = el.matches(parsed.value) ? el : el.querySelector(parsed.value);
  return node ? finalize(nodeValue(node as Element, parsed.attr), parsed.attr, baseUrl) : "";
}

export function evalJs(expr: string, ctx: { node?: Element; doc: Document; baseUrl?: string }): string {
  const java = {
    base64Decode: (b64: string) =>
      new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
    regex: (input: string, pattern: string) => {
      const m = input.match(new RegExp(pattern));
      return m ? (m[1] ?? m[0]) : "";
    },
  };
  const fn = new Function("node", "doc", "result", "baseUrl", "java", `"use strict"; return (${expr});`);
  try {
    const result = fn(ctx.node ?? null, ctx.doc, "", ctx.baseUrl ?? "", java);
    return result == null ? "" : String(result);
  } catch (e) {
    return "";
  }
}
