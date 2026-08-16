import { md5 } from "./md5";
import { SymmetricCrypto } from "./aes";
import { getSourceVars } from "./sourceVars";
import { getJsLib, loadJsLib } from "./jsLib";
import { httpGet, mergeUserAgent } from "./api";

export type EngineResult = string;

export type ParsedRule = {
  type: "css" | "regex" | "regexReplace" | "js" | "xpath" | "json" | "plain" | "jsBlock";
  value: string;
  attr?: string;
  after?: string;
  replace?: Array<[string, string]>;
  /** regexReplace 专用：正则 / 替换串 / replaceFirst 模式（legado ##re##rep / ##re##rep###） */
  regex?: string;
  replacement?: string;
  replaceFirst?: boolean;
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

export function parseBookSourceJson(raw: string): BookSource {
  const obj = JSON.parse(raw);
  if (!obj.bookSourceUrl || !obj.bookSourceName) {
    throw new Error("书源缺少 bookSourceUrl 或 bookSourceName");
  }
  const src = obj as BookSource;
  // 注册源自带 jsLib（legado 源常内嵌 jsLib 供 @js: 规则调用，如加密函数）
  if (src.jsLib) loadJsLib(src.bookSourceUrl, src.jsLib);
  return src;
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function jsonGet(obj: any, path: string): any {
  if (obj == null) return undefined;
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);
  if (!p) return obj;
  return jsonWalk(obj, jsonTokens(p));
}

// 路径分词：[] 括号内容整体为一个 token（兼容 ?(...) 过滤里的 .），其余按 . 分隔
function jsonTokens(p: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "[") {
      const end = p.indexOf("]", i);
      if (end === -1) break;
      tokens.push(p.slice(i + 1, end));
      i = end + 1;
    } else if (ch === ".") {
      i++;
    } else {
      let end = p.length;
      const dot = p.indexOf(".", i);
      const br = p.indexOf("[", i);
      if (dot !== -1 && dot < end) end = dot;
      if (br !== -1 && br < end) end = br;
      if (end > i) tokens.push(p.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

// legado JsonPath 子集：支持 [n] 索引、[*] 通配（返回匹配数组）、[a:b] 范围切片、[?(条件)] 过滤、数组上取字段
function jsonWalk(cur: any, tokens: string[]): any {
  if (tokens.length === 0 || cur == null) return cur;
  const tok = tokens[0];
  const rest = tokens.slice(1);
  if (Array.isArray(cur)) {
    if (/^\d+$/.test(tok)) return jsonWalk(cur[Number(tok)], rest);
    if (tok === "*") {
      const out = cur.map((it) => jsonWalk(it, rest)).filter((v) => v != null);
      return out.length ? out : undefined;
    }
    if (/^\d+:\d+$/.test(tok)) {
      const [a, b] = tok.split(":").map(Number);
      const out = cur.slice(a, b).map((it) => jsonWalk(it, rest)).filter((v) => v != null);
      return out.length ? out : undefined;
    }
    const fm = tok.match(/^\?\((.*)\)$/);
    if (fm) {
      const out = cur.filter((it) => jsonFilter(it, fm[1]));
      return jsonWalk(out, rest);
    }
    // 数组上取字段：逐项映射
    const out = cur.map((it) => jsonWalk(it, tokens)).filter((v) => v != null);
    return out.length ? out : undefined;
  }
  if (tok === "*") return jsonWalk(cur, rest);
  if (/^\d+:\d+$/.test(tok)) return undefined;
  const fm = tok.match(/^\?\((.*)\)$/);
  if (fm) return cur;
  return jsonWalk(cur[tok], rest);
}

// JSONPath 过滤条件求值：支持 ==/!=/>/</>=/<=、&&/||、@. 前缀、存在性
function jsonFilter(item: any, expr: string): boolean {
  return expr.split("||").some((o) =>
    o.split("&&").every((a) => jsonFilterAtom(item, a.trim())),
  );
}

function jsonFilterAtom(item: any, atom: string): boolean {
  if (!atom) return true;
  const m = atom.match(/^(?:@\.)?([\w-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    const key = atom.replace(/^@\./, "").trim();
    return key ? !!item?.[key] : false;
  }
  const val = item?.[m[1]];
  const raw = m[3].trim();
  let target: any = raw;
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    target = raw.slice(1, -1);
  } else if (raw === "true") {
    target = true;
  } else if (raw === "false") {
    target = false;
  } else if (!Number.isNaN(Number(raw)) && raw.trim() !== "") {
    target = Number(raw);
  }
  switch (m[2]) {
    case "==": return val == target;
    case "!=": return val != target;
    case ">": return Number(val) > Number(target);
    case "<": return Number(val) < Number(target);
    case ">=": return Number(val) >= Number(target);
    case "<=": return Number(val) <= Number(target);
  }
  return false;
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
  // XPath 字符串函数开头（string(...)/normalize-space(...) 等）：css 选择器不会以这些开头
  if (/^(?:string|normalize-space|substring|substring-before|substring-after|concat|translate|replace|lower-case|upper-case|number|contains|count|sum)\(/.test(s)) {
    return { type: "xpath", value: s };
  }
  if (s.startsWith("@css:")) {
    return parseAttrRule(s.slice(5), true);
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
  // legado ## 替换规则（对齐原版 SourceRule：rule.split("##")）
  //   ##re##rep       → 对节点 outerHtml 全替换
  //   ##re##rep###    → replaceFirst：取第一个匹配的 group0 替换，无匹配返回空
  if (s.startsWith("##")) {
    const parts = s.split("##");
    return {
      type: "regexReplace",
      value: s,
      regex: parts[1] ?? "",
      replacement: parts[2] ?? "",
      replaceFirst: parts.length > 3,
    };
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

function parseAttrRule(s: string, cssMode = false): ParsedRule {
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
  // @CSS: 前缀模式（legado isCss）：裸单词 = 标签选择器（如 @css:li）
  if (cssMode && /^[a-zA-Z][\w-]*$/.test(body)) {
    return { type: "css", value: body, attr: "text", replace };
  }
  // 对齐原版 AnalyzeByJSoup：无 @CSS: 前缀的裸单词 = 属性名（onclick 等），
  // 选择器需 . / # / tag. / @ 前缀（如 onclick##.*\\((\\d+)\\);##$1）
  if (!cssMode && /^[a-zA-Z][\w-]*$/.test(body)) {
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
  try {
    return Array.from(doc.querySelectorAll(normalizeSelector(selector)));
  } catch {
    const hit = queryIndexed(selector, doc);
    return hit ? [hit] : [];
  }
}

/** legado 选择器简写规范化：id.x → #x；class.a b c → .a.b.c（多类）；!索引由 queryIndexed 处理 */
export function normalizeSelector(sel: string): string {
  let s = sel.trim();
  if (s.startsWith("id.")) return `#${s.slice(3)}`;
  if (s.startsWith("class.")) {
    // class.a b c → .a.b.c（多类合并）；正常 .a b 后代选择器不受影响
    return `.${s.slice(6).trim().split(/\s+/).join(".")}`;
  }
  return s;
}

/** 安全选择：常规 querySelectorAll（含 legado 简写规范化），失败则回退 queryIndexed 单节点 */
function selectNodesSafe(selector: string, scope: Document | Element): Element[] {
  try {
    return Array.from(scope.querySelectorAll(normalizeSelector(selector)));
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
  /** 当前书籍信息（legado js 上下文 book：bookUrl/tocUrl/name/author 等），注入 evalJs */
  book?: any;
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
  // 链式 css@js:...：先按前段提取，把结果作为 result 交给 js 处理（json 混合走下方 json 分支）
  const jsIdx = rule.indexOf("@js:");
  const trimmed = rule.trimStart();
  if (jsIdx > 0 && !trimmed.startsWith("@Json:") && !trimmed.startsWith("$.") && !trimmed.startsWith("$[")) {
    const base = await extractSingle(doc, rule.slice(0, jsIdx), ctx);
    return String(evalJs(rule.slice(jsIdx + 4), { doc, result: base, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
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
    // 选择器为空：对文档（原版 jsoup doc.toString() = 完整 html）做正则提取/替换
    const source = doc.documentElement?.outerHTML ?? "";
    return applyRegexReplace(source, parsed);
  }
  if (parsed.type === "xpath") {
    const expr = parsed.value.trim();
    // 表达式结果是字符串（text()/@属性结尾，或含字符串函数调用）时用 STRING_TYPE 直接取值；
    // 以 /@href 或 /@src 结尾时按 URL 解析
    const isStringExpr =
      /(?:text\(\)|@[\w-]+)\s*$/.test(expr)
      || /(?:string|normalize-space|substring|substring-before|substring-after|concat|translate|replace|lower-case|upper-case|number|contains|count|sum)\(/.test(expr);
    const isUrlExpr = /\/@(?:href|src)\s*$/.test(expr);
    if (isStringExpr) {
      const sv = doc.evaluate(expr, doc, null, XPathResult.STRING_TYPE, null);
      const str = (sv.stringValue ?? "").trim();
      return str ? finalize(applyReplacements(str, parsed.replace), isUrlExpr ? "href" : "text", ctx?.baseUrl) : "";
    }
    const result = doc.evaluate(expr, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue as Element | null;
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
  }
  if (parsed.type === "js") {
    return evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, book: ctx?.book });
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
    const raw = evalJs(parsed.value, jsCtx);
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
    // legado 行为：jsBlock 的返回值改写成后续规则的 result（如 result=解码后的 JSON 再走 $.book_list.*）
    const rawStr = raw == null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (rawStr && rawStr !== String(ctx?.result ?? "")) {
      newCtx = { ...(newCtx ?? {}), result: rawStr, sourceKey: ctx?.sourceKey, source: ctx?.source, baseUrl: ctx?.baseUrl, cookieHost: ctx?.cookieHost };
      jsDoc = parseHtml(rawStr);
    }
    return extractSingle(jsDoc, parsed.after ?? "", newCtx);
  }
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取文档自身（extractSingle 场景少见，返回空）
    return "";
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, doc) ?? queryIndexed(parsed.value, doc);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
  }
  // 链式 A@B@C（如 class.recommend[-1]@a@text）：从文档起逐层下钻
  if (parsed.value.includes("@")) {
    const segs = parsed.value.split("@").map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      const last = segs[segs.length - 1];
      if (last.startsWith("js:")) {
        const pre = segs.slice(0, -1);
        let cur: Element | null = queryIndexed(pre[0], doc);
        for (let i = 1; i < pre.length && cur; i++) cur = queryIndexed(pre[i], cur);
        if (!cur) return "";
        try {
          return String(evalJs(last.slice(3), { doc, node: cur, result: "", baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
        } catch {
          return "";
        }
      }
      let cur: Element | null = queryIndexed(segs[0], doc);
      for (let i = 1; i < segs.length && cur; i++) cur = queryIndexed(segs[i], cur);
      return cur
        ? finalize(applyReplacements(nodeValue(cur, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl)
        : "";
    }
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
  // legado bookList 支持 && 合并多个列表规则（js 块内的 && 不受影响）
  const masked = trimmedList.replace(/<js>[\s\S]*?<\/js>/g, (m) => "x".repeat(m.length));
  if (masked.includes("&&")) {
    const parts: string[] = [];
    let last = 0;
    let idx = masked.indexOf("&&");
    while (idx !== -1) {
      parts.push(trimmedList.slice(last, idx));
      last = idx + 2;
      idx = masked.indexOf("&&", last);
    }
    parts.push(trimmedList.slice(last));
    const clean = parts.map((s) => s.trim()).filter(Boolean);
    if (clean.length > 1) {
      const merged: Array<Record<string, string>> = [];
      for (const part of clean) {
        const items = await extractList(doc, part, itemRules, ctx);
        merged.push(...items);
      }
      return merged;
    }
  }
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
        const seg = chain[i];
        // legado A@js:... 链：js 接收 result = 匹配到的元素列表（jsoup Elements，含 toArray()/size()/get(i)）
        if (seg.startsWith("js:")) {
          const jnodes = jArr(nodes.map((n) => jsoupNode(n)));
          const raw = evalJs(seg.slice(3), {
            doc, result: jnodes,
            baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, source: ctx?.source,
          });
          const arr = Array.isArray(raw) ? raw : [];
          // js 返回的是 jsoup 包装节点（同一 DOM 元素），或字符串/对象（后续按 json 处理时保持）
          nodes = arr
            .map((x: any) => (x && typeof x === "object" && x.__jsoup ? x : null))
            .filter(Boolean);
          continue;
        }
        const next: Element[] = [];
        for (const n of nodes) {
          // legado tag.X 段：取节点内所有指定标签（如 tag.li）
          if (/^tag\.[a-zA-Z][\w-]*$/.test(chain[i])) {
            next.push(...Array.from(n.querySelectorAll(chain[i].slice(4))));
            continue;
          }
          // legado `!N` 段（如 li!0 / tr!1）：列表语义 = 跳过前 N 个，取剩余全部（用于跳表头）
          const bang = chain[i].match(/^(?:(?:tag\.)?)(.+?)!(\d+|last)$/);
          if (bang) {
            let all: Element[];
            try {
              all = Array.from(n.querySelectorAll(normalizeSelector(bang[1])));
            } catch {
              all = [];
            }
            const startIdx = bang[2] === "last" ? Math.max(0, all.length - 1) : parseInt(bang[2], 10);
            next.push(...all.slice(startIdx));
            continue;
          }
          // 段含类索引（如 .clearfix.1）→ 取指定第 N 个；否则取全部匹配
          if (/\.\d+$/.test(chain[i])) {
            const hit = queryIndexed(chain[i], n);
            if (hit) next.push(hit);
          } else {
            const norm = normalizeSelector(chain[i]);
            try {
              next.push(...Array.from(n.querySelectorAll(norm)));
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
        for (const [key, rule] of Object.entries(itemRules)) out[key] = extractItemValue(node, key, rule, ctx);
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
      for (const [key, rule] of Object.entries(itemRules)) out[key] = extractItemValue(node, key, rule, ctx);
      return out;
    });
  }
  if (parsed.type === "js") {
    const raw = evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, book: ctx?.book });
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
        out[key] = extractFromJsonObject(item, rule, { baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book });
      }
      return out;
    });
  }
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source };
    const raw = evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as any)._ajaxUrl as string | undefined;
    let jsDoc = ctx?.doc ?? doc;
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const html = await httpGet(ajaxUrl, headers, undefined, undefined, undefined, undefined, ctx?.cookieHost ?? "");
      jsDoc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    // legado 行为：jsBlock 的返回值改写成后续规则的 result（如 result=解码后的 JSON 再走 $.book_list.*）
    const rawStr = raw == null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (rawStr && rawStr !== String(ctx?.result ?? "")) {
      newCtx = { ...(newCtx ?? {}), result: rawStr, sourceKey: ctx?.sourceKey, source: ctx?.source, baseUrl: ctx?.baseUrl, cookieHost: ctx?.cookieHost };
      jsDoc = parseHtml(rawStr);
    }
    return extractList(jsDoc, parsed.after ?? "", itemRules, newCtx);
  }
  if (parsed.type !== "css") return [];
  const nodes = selectNodes(doc, parsed.value);
  return nodes.map((node) => {
    const out: Record<string, string> = {};
    for (const [key, rule] of Object.entries(itemRules)) {
      out[key] = extractItemValue(node, key, rule, ctx);
    }
    return out;
  });
}

/** item 字段提取 + URL 字段（bookUrl/coverUrl）相对地址解析（regexReplace 等规则产出相对路径） */
function extractItemValue(node: Element, key: string, rule: string, ctx?: ExtractContext): string {
  let v = extractFromElement(node, rule, ctx?.baseUrl, ctx?.book);
  if ((key === "bookUrl" || key === "coverUrl") && v && !ABS_URL_RE.test(v)) {
    v = resolveUrl(v, ctx?.baseUrl ?? "");
  }
  return v;
}

export function extractFromJsObject(obj: any, rule: string, baseUrl?: string, sourceKey?: string): string {
  return extractFromJsonObject(obj, rule, { baseUrl, sourceKey });
}

export function extractFromJsonObject(
  obj: any,
  rule: string,
  ctx?: { baseUrl?: string; sourceKey?: string; book?: any },
): string {
  if (obj == null || typeof obj !== "object") return "";
  const s = rule.trim();
  if (!s) return "";
  const jsIdx = s.indexOf("@js:");
  if (jsIdx === 0) {
    return String(evalJs(s.slice(4), { doc: emptyDoc(), result: obj, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
  }
  const pathPart = (jsIdx > 0 ? s.slice(0, jsIdx) : s).trim();
  const path = pathPart.startsWith("@Json:")
    ? pathPart.slice(6).trim()
    : pathPart.replace(/^\$\.?/, "");
  const v = jsonGet(obj, path);
  if (jsIdx > 0) {
    return String(evalJs(s.slice(jsIdx + 4), { doc: emptyDoc(), result: v, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
  }
  if (v == null) return "";
  const str = String(v);
  if (str && isUrlField(path) && ctx?.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(str)) return resolveUrl(str, ctx.baseUrl);
  return str;
}

export function extractFromElement(el: Element, rule: string, baseUrl?: string, book?: any): string {
  // item 规则 `<js>...</js>` 后缀（legado：前段提取值作 result 交给 js 处理，
  // 如 chapterUrl: `onclick##.*\\((\\d+)\\);##$1\n<js>…book.bookUrl…</js>`）
  const jsIdx = rule.indexOf("<js>");
  if (jsIdx > 0) {
    const jsEnd = rule.indexOf("</js>", jsIdx);
    if (jsEnd !== -1) {
      const base = extractFromElement(el, rule.slice(0, jsIdx), baseUrl, book);
      try {
        return String(evalJs(rule.slice(jsIdx + 4, jsEnd), {
          doc: el.ownerDocument ?? emptyDoc(), node: el, result: base, baseUrl, book,
        }) ?? "");
      } catch {
        return "";
      }
    }
  }
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
      return String(evalJs(parsed.value, { doc: el.ownerDocument ?? emptyDoc(), node: el, result: "", baseUrl, book }) ?? "");
    } catch {
      return "";
    }
  }
  if (parsed.type === "regexReplace") {
    // 选择器为空：对节点 outerHtml 做正则提取/替换（jsoup Element.toString() = outerHtml）
    return applyRegexReplace(el.outerHTML, parsed);
  }
  if (parsed.type !== "css") return "";
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取当前节点自身
    return finalize(applyReplacements(nodeValue(el, parsed.attr), parsed.replace), parsed.attr, baseUrl);
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, el) ?? queryIndexed(parsed.value, el);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
  }
  // item 内链式规则（legado A@B@C，如 .row@a@text / .item@h3@href）：
  // parseAttrRule 已把末尾 @属性 拆到 parsed.attr，这里 value 里剩余的 @ 段逐层下钻
  if (parsed.value.includes("@")) {
    const segs = parsed.value.split("@").map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      const last = segs[segs.length - 1];
      // 末段 js: → 对下钻到的节点执行 js（node = 当前元素）
      if (last.startsWith("js:")) {
        let cur: Element | null = el;
        for (const seg of segs.slice(0, -1)) {
          if (!cur) return "";
          cur = queryIndexed(seg, cur);
        }
        if (!cur) return "";
        try {
          return String(evalJs(last.slice(3), { doc: el.ownerDocument ?? emptyDoc(), node: cur, result: "", baseUrl, book }) ?? "");
        } catch {
          return "";
        }
      }
      let cur: Element | null = el;
      for (const seg of segs) {
        if (!cur) return "";
        cur = queryIndexed(seg, cur);
      }
      return cur
        ? finalize(applyReplacements(nodeValue(cur, parsed.attr), parsed.replace), parsed.attr, baseUrl)
        : "";
    }
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
 * legado `##` 前缀替换规则（对齐原版 AnalyzeRule.replaceRegex）：
 * - replaceFirst（##re##rep###）：取第一个匹配的 group0 用 replacement 替换；无匹配返回空
 * - 否则（##re##rep）：对整个 source 全部替换
 */
function applyRegexReplace(source: string, parsed: ParsedRule): string {
  if (!parsed.regex) return "";
  try {
    if (parsed.replaceFirst) {
      const re = new RegExp(parsed.regex);
      const m = re.exec(source);
      if (!m) return "";
      return m[0].replace(re, parsed.replacement ?? "");
    }
    return source.replace(new RegExp(parsed.regex, "g"), parsed.replacement ?? "");
  } catch {
    return "";
  }
}

/**
 * 在 scope 内查找选择器命中节点；支持 legado `.class.N` 语法（取第 N 个匹配）。
 * 先尝试常规 querySelector；失败（非法选择器）或带数字后缀时，按 base 选择器 + index 取。
 */
export function queryIndexed(selector: string, scope: Document | Element): Element | null {
  const sel = selector.trim();
  // legado text.xxx：元素文本等于 xxx（锚点定位，如 text.章节目录 / text.下一章）
  if (sel.startsWith("text.")) {
    const target = sel.slice(5).trim();
    const all = scope.querySelectorAll("*");
    for (const el of all) {
      if ((el.textContent ?? "").trim() === target) return el;
    }
    return null;
  }
  // legado `!` 索引：`tr!0`（第 0 个）/`tag.tr!0`（tag 前缀剥除）/`xxx!last`
  const bang = sel.match(/^(?:(?:tag\.)?)(.+?)!(\d+|last)$/);
  if (bang) {
    try {
      const nodes = scope.querySelectorAll(normalizeSelector(bang[1]));
      const idx = bang[2] === "last" ? nodes.length - 1 : parseInt(bang[2], 10);
      return nodes[idx] ?? null;
    } catch {
      return null;
    }
  }
  // legado 括号索引：`class.recommend[-1]`（倒数第 1 个）/`.item[0]`（第 0 个）
  const br = sel.match(/^(?:(?:tag\.)?)(.+?)\[(-?\d+)\]$/);
  if (br) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = scope.querySelectorAll(normalizeSelector(br[1]));
    } catch {
      return null;
    }
    const i = parseInt(br[2], 10);
    return nodes[i < 0 ? nodes.length + i : i] ?? null;
  }
  try {
    const hit = scope.querySelector(normalizeSelector(sel));
    if (hit) return hit;
    // 合法但无匹配（如 "tag.span" 视为 tag 元素）→ 继续走 tag.X / 索引回退
  } catch {
    // 非法选择器（如 .author.0）→ 尝试拆分 .数字 后缀
  }
  // legado tag.X（无索引）→ 取第一个匹配标签
  const tm = sel.match(/^tag\.([a-zA-Z][\w-]*)$/);
  if (tm) {
    try { return scope.querySelector(tm[1]) ?? null; } catch { return null; }
  }
  const m = sel.match(/^(.+?)\.(\d+)$/);
  if (!m) return null;
  const base = m[1];
  const index = parseInt(m[2], 10);
  let nodes: NodeListOf<Element>;
  try {
    nodes = scope.querySelectorAll(normalizeSelector(base));
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
  def(a, "toArray", () => arr.map((n) => jsoupNode(n)));
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
  /** 当前书籍信息（legado js 上下文 book） */
  book?: any;
}

// legado 字符集名（GBK/GB2312/UTF-16…）映射到 TextDecoder 标签；编码侧仅 UTF-8 原生支持
function decodeCharset(bytes: Uint8Array, charset: string): string {
  const label = charsetLabel(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function encodeCharset(s: string, charset: string): Uint8Array {
  const label = charsetLabel(charset);
  try {
    if (label === "utf-8") return new TextEncoder().encode(s);
    // 非 UTF-8 编码：借 TextEncoder 不可行，尝试用 TextDecoder 不可逆；退化为 UTF-8
    return new TextEncoder().encode(s);
  } catch {
    return new TextEncoder().encode(s);
  }
}

function charsetLabel(charset: string): string {
  const c = String(charset).trim().toLowerCase().replace(/[_-]/g, "");
  if (c === "gbk" || c === "gb2312" || c === "gb18030") return "gbk";
  if (c === "utf16" || c === "utf16le" || c === "unicode") return "utf-16le";
  if (c === "utf16be") return "utf-16be";
  if (c === "big5") return "big5";
  return "utf-8";
}

export function evalJs(expr: string, ctx: JsContext): any {
  const vars = getSourceVars(ctx.sourceKey ?? "default");
  const java = {
    encodeURI: (s: string, _charset?: string) => encodeURIComponent(String(s)),
    decodeURI: (s: string, _charset?: string) => decodeURIComponent(String(s)),
    // legado java.base64Decode(text, charset)：按指定字符集解码（UTF-8/GBK/UTF-16 等）
    base64Decode: (b64: string, charset = "utf-8") =>
      decodeCharset(Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0)), charset),
    base64Encode: (s: string, charset = "utf-8") => {
      const bytes = encodeCharset(String(s), charset);
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
    // legado java.getString(rule, html?)：对 html 字符串应用 CSS/属性规则同步提取；
    // 省略 html 时用当前 result（原版默认 content）
    getString: (rule: string, html?: string) => {
      try {
        const source = html != null ? String(html) : String(ctx.result ?? "");
        const doc = parseHtml(source);
        const parsed = parseRule(String(rule));
        if (parsed.type === "css") {
          const node = parsed.value ? queryIndexed(parsed.value, doc) : doc.body;
          return node ? nodeValue(node, parsed.attr) : "";
        }
        if (parsed.type === "regexReplace") {
          return applyRegexReplace(doc.documentElement?.outerHTML ?? "", parsed);
        }
        return "";
      } catch {
        return "";
      }
    },
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
    base64DecodeToByteArray: (b64: string) =>
      Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0)),
    stringToByteArray: (s: string) => new TextEncoder().encode(String(s ?? "")),
    byteArrayToString: (b: any) => {
      const arr = Array.from((b ?? []) as ArrayLike<number>);
      return new TextDecoder("utf-8").decode(Uint8Array.from(arr));
    },
    getByteLength: (s: string) => new TextEncoder().encode(String(s ?? "")).length,
    // 同步上下文无法真实发请求：返回空响应对象，避免源抛错（URL 生成可继续）
    post: (_url: string, _body: string, _opts?: any) => ({ header: () => "", status: 200, body: "" }),
    longToast: () => "",
    shortToast: () => "",
    guid: () => {
      const c = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
      return `${c()}${c()}-${c()}-${c()}-${c()}-${c()}${c()}${c()}`;
    },
  };
  const source = ctx.source ?? {};
  // legado source.getKey() 返回书源 key（bookSourceUrl），书源脚本常用（如 cookie.removeCookie(source.getKey())）
  if (!source.getKey) source.getKey = () => String((source as any).bookSourceUrl ?? "");
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
  const srcLib = (ctx.source as any)?.jsLib as string | undefined;
  const lib = jsLibCode || (srcLib && !/^https?:\/\//i.test(srcLib.trim()) ? srcLib.trim() : "");
  if (lib) {
    body = `${lib}\n${body}`;
  }
  try {
    // cookie 全局（legado 书源常用 cookie.removeCookie/getCookie/setCookie）
    const cookie = {
      removeCookie: (_name: string) => "",
      getCookie: (_name: string) => "",
      setCookie: (_name: string, _value: string) => "",
    };
    // new Function 构造时即解析语法：须在 try 内，否则书源 @js: 表达式的语法错误会冒泡导致整条规则失败
    const fn = new Function(
      "node", "doc", "result", "src", "baseUrl", "key", "page", "source", "java", "url", "TYPE", "cookie", "book",
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
        ctx.result ?? "", ctx.result ?? "", ctx.baseUrl ?? "", ctx.key ?? "", ctx.page ?? 1,
        source, java, ctx.baseUrl ?? "", TYPE, cookie, ctx.book ?? {},
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

export function resolveSearchUrl(searchUrl: string, key: string, page: number, ctx?: { sourceKey?: string; source?: any }): { url: string; method?: string; body?: string } {
  const s = searchUrl.trim();
  if (s.startsWith("@js:")) {
    const url = String(evalJs(s.slice(4), {
      doc: emptyDoc(), key, page, result: "",
      sourceKey: ctx?.sourceKey, source: ctx?.source,
    }) ?? "");
    // jsBlock 可能产出 legado 的 "URL,{json 请求选项}" 形式（如 url="https://x/search/,"+JSON.stringify({method:"POST",body})）
    return parseSearchUrl(url, key);
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
