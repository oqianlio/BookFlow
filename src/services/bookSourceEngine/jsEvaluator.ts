/**
 * JS 执行模块
 * 负责执行 legado 书源中的 @js: 规则和 <js>...</js> 代码块
 */

import { md5 } from "../md5";
import { SymmetricCrypto } from "../aes";
import { getSourceVars } from "../sourceVars";
import { getJsLib } from "../jsLib";
import { cachedParseRule, parseHtml, applyRegexReplace } from "./ruleParser";
import { queryIndexed, nodeValue } from "./ruleSelector";

// ============ JS 上下文类型 ============

export interface JsContext {
  node?: Element;
  doc: Document;
  result?: unknown;
  baseUrl?: string;
  key?: string;
  page?: number;
  source?: JsSource;
  sourceKey?: string;
  /** cookie jar 键（书源域名），与 httpGet 的 cookieJar 参数对齐 */
  cookieJar?: string;
  /** 当前书籍信息（legado js 上下文 book：bookUrl/tocUrl/name/author 等） */
  book?: Record<string, unknown>;
  /** legado js 上下文 chapter（当前章节对象：url/title/index） */
  chapter?: Record<string, unknown>;
  /** legado js 上下文 title（当前书名） */
  title?: string;
  /** legado js 上下文 src（当前内容 HTML） */
  src?: string;
  /** legado js 上下文 nextChapterUrl（下一章 URL） */
  nextChapterUrl?: string;
}

export interface JsSource {
  bookSourceUrl?: string;
  bookSourceName?: string;
  bookSourceType?: number;
  httpUserAgent?: string;
  httpHeaders?: Record<string, string>;
  jsLib?: string;
  getKey?: () => string;
  getVariable?: () => string;
  putVariable?: (v: string) => string;
  setVariable?: (v: string) => string;
  [key: string]: unknown;
}

// ============ 字符集处理 ============

/** legado 字符集名（GBK/GB2312/UTF-16…）映射到 TextDecoder 标签；编码侧仅 UTF-8 原生支持 */
function charsetLabel(charset: string): string {
  const c = String(charset).trim().toLowerCase().replace(/[_-]/g, "");
  if (c === "gbk" || c === "gb2312" || c === "gb18030") return "gbk";
  if (c === "utf16" || c === "utf16le" || c === "unicode") return "utf-16le";
  if (c === "utf16be") return "utf-16be";
  if (c === "big5") return "big5";
  return "utf-8";
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  const label = charsetLabel(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function encodeCharset(s: string, _charset: string): Uint8Array {
  // 非 UTF-8 编码退化为 UTF-8
  return new TextEncoder().encode(s);
}

// ============ JSoup 风格节点 API ============

// 大量 legado 书源在 @js: 规则里使用 jsoup 方法（node.select/selectFirst/attr/text/children 等），
// 裸 Element 不具备这些方法导致规则失败。这里给节点附加 jsoup 风格方法（实例级，不污染原型）。
type JNode = Element & Record<string, unknown>;

/** 实例属性遮蔽：children/body 等只读访问器需 defineProperty 才能覆盖 */
function def(o: unknown, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
}

export function jArr(arr: Element[]): unknown[] {
  const a = arr as unknown;
  def(a, "first", () => (arr[0] ? jsoupNode(arr[0]) : null));
  def(a, "last", () => (arr[arr.length - 1] ? jsoupNode(arr[arr.length - 1]) : null));
  def(a, "size", () => arr.length);
  def(a, "get", (i: number) => (arr[i] ? jsoupNode(arr[i]) : null));
  def(a, "toArray", () => arr.map((n) => jsoupNode(n)));
  def(a, "text", () => arr.map((n) => (n.textContent ?? "")).join("").trim());
  def(a, "attr", (k: string) => arr[0]?.getAttribute(k) ?? "");
  def(a, "html", () => arr.map((n) => n.innerHTML).join(""));
  return a as unknown[];
}

export function jsoupNode(n: Element): JNode {
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
    for (const c of n.childNodes) if (c.nodeType === 3) s += c.textContent ?? "";
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

function jsoupDoc(doc: Document): Document & Record<string, unknown> {
  const o = doc as Document & Record<string, unknown>;
  if (o.__jsoup) return o;
  def(o, "__jsoup", true);
  def(o, "select", (sel: string) => jArr(Array.from(doc.querySelectorAll(sel))));
  def(o, "selectFirst", (sel: string) => { const e = doc.querySelector(sel); return e ? jsoupNode(e) : null; });
  def(o, "text", () => doc.body?.textContent?.trim() ?? "");
  def(o, "html", () => doc.body?.innerHTML ?? "");
  def(o, "body", () => (doc.body ? jsoupNode(doc.body) : null));
  return o;
}

// ============ JS 执行 ============

export function evalJs(expr: string, ctx: JsContext): unknown {
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
    createSymmetricCrypto: (transformation: string, key: string, iv?: string) =>
      new SymmetricCrypto(transformation, key, iv),
    put: (k: string, v: unknown) => { const s = v == null ? "" : String(v); vars.set(String(k), s); return s; },
    get: (k: string) => vars.get(String(k)) ?? "",
    // legado java.getString(rule, html?)：对 html 字符串应用 CSS/属性规则同步提取；
    // 省略 html 时用当前 result（原版默认 content）
    getString: (rule: string, html?: string) => {
      try {
        const source = html != null ? String(html) : String(ctx.result ?? "");
        const doc = parseHtml(source);
        const parsed = cachedParseRule(String(rule));
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
    // legado java.timeFormat(timestamp)：秒级/毫秒级时间戳 → "YYYY-MM-DD HH:mm:ss"
    timeFormat: (ts: unknown, fmt?: string) => {
      const n = Number(ts);
      if (!Number.isFinite(n)) return "";
      const ms = n > 1e12 ? n : n * 1000; // 秒→毫秒（>1e12 视为已毫秒）
      const d = new Date(ms);
      if (isNaN(d.getTime())) return "";
      const pad = (v: number) => String(v).padStart(2, "0");
      return (fmt ?? "YYYY-MM-DD HH:mm:ss")
        .replace("YYYY", String(d.getFullYear()))
        .replace("MM", pad(d.getMonth() + 1))
        .replace("DD", pad(d.getDate()))
        .replace("HH", pad(d.getHours()))
        .replace("mm", pad(d.getMinutes()))
        .replace("ss", pad(d.getSeconds()));
    },
    ajax: (url: unknown) => { (ctx as unknown as Record<string, unknown>)._ajaxUrl = String(url ?? ""); return ""; },
    toString: (x: unknown) => String(x ?? ""),
    toJSONString: (x: unknown) => {
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
    byteArrayToString: (b: unknown) => {
      const arr = Array.from((b ?? []) as ArrayLike<number>);
      return new TextDecoder("utf-8").decode(Uint8Array.from(arr));
    },
    getByteLength: (s: string) => new TextEncoder().encode(String(s ?? "")).length,
    // 同步上下文无法真实发请求：返回空响应对象，避免源抛错（URL 生成可继续）
    post: (_url: string, _body: string, _opts?: unknown) => ({ header: () => "", status: 200, body: "" }),
    longToast: () => "",
    shortToast: () => "",
    guid: () => {
      const c = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
      return `${c()}${c()}-${c()}-${c()}-${c()}-${c()}${c()}${c()}`;
    },
  };
  const source = (ctx.source ?? {}) as JsSource;
  // legado source.getKey() 返回书源 key（bookSourceUrl），书源脚本常用（如 cookie.removeCookie(source.getKey())）
  if (!source.getKey) source.getKey = () => String(source.bookSourceUrl ?? "");
  // 自定义 source 方法优先；未提供时才注入会话变量兜底（get/put/set 三者对称）
  if (!source.getVariable) source.getVariable = () => String(vars.get("variable") ?? "");
  if (!source.putVariable) source.putVariable = (v: string) => { vars.set("variable", String(v)); return ""; };
  if (!source.setVariable) source.setVariable = (v: string) => { vars.set("variable", String(v)); return ""; };
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
  const srcLib = source.jsLib;
  const lib = jsLibCode || (srcLib && !/^https?:\/\//i.test(String(srcLib).trim()) ? String(srcLib).trim() : "");
  if (lib) {
    body = `${lib}\n${body}`;
  }
  try {
    // 安全检查：检测危险的全局访问模式
    const dangerousPatterns = [
      /\bimport\s*\(/,           // 动态 import
      /\brequire\s*\(/,          // Node.js require
      /\bprocess\./,             // Node.js process
      /\bchild_process\b/,       // Node.js child_process
      /\beval\s*\(/,             // 嵌套 eval
      /\bFunction\s*\(/,         // 嵌套 Function 构造
      /\bglobalThis\b/,          // 直接访问 globalThis
      /\bwindow\b/,              // 浏览器 window
      /\bdocument\b\s*\./,       // document 对象（非参数）
      /\bnavigator\b/,           // navigator 对象
      /\bfetch\s*\(/,            // 网络请求（应通过 java.ajax）
      /\bXMLHttpRequest\b/,      // XHR
      /\bWebSocket\b/,           // WebSocket
      /\bimportScripts\b/,       // Worker importScripts
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(body)) {
        console.warn(`[jsEvaluator] 检测到潜在危险代码模式: ${pattern.source}, sourceKey: ${ctx.sourceKey}`);
        // 记录但不阻止执行（兼容现有书源），仅作为安全审计日志
      }
    }

    // cookie 全局（legado 书源常用 cookie.removeCookie/getCookie/setCookie）
    const cookie = {
      removeCookie: (_name: string) => "",
      getCookie: (_name: string) => "",
      setCookie: (_name: string, _value: string) => "",
    };
    // new Function 构造时即解析语法：须在 try 内，否则书源 @js: 表达式的语法错误会冒泡导致整条规则失败
    // 注意：此执行环境无法完全沙箱化，因为 legado 书源需要访问全局对象
    const fn = new Function(
      "node", "doc", "result", "src", "baseUrl", "key", "page", "source", "java", "url", "TYPE", "cookie", "book",
      "chapter", "title", "nextChapterUrl",
      body,
    );
    const g = globalThis as Record<string, unknown>;
    const prevSource = g.__ydSource;
    g.__ydSource = source;
    const prevThisSource = (g as Record<string, unknown>).source;
    (g as Record<string, unknown>).source = source;
    try {
      // node/doc 传入 jsoup 风格包装（附加 select/selectFirst/attr/text 等方法），兼容 legado @js: 书源
      // legado 变量作用域：chapter→book→session(source)；@js 里可用 chapter/title/src/nextChapterUrl
      return fn.call(
        { source },
        ctx.node ? jsoupNode(ctx.node) : null,
        jsoupDoc(ctx.doc),
        ctx.result ?? "", ctx.src ?? ctx.result ?? "", ctx.baseUrl ?? "", ctx.key ?? "", ctx.page ?? 1,
        source, java, ctx.baseUrl ?? "", TYPE, cookie, ctx.book ?? {},
        ctx.chapter ?? {}, ctx.title ?? (ctx.book as Record<string, unknown>)?.name ?? "", ctx.nextChapterUrl ?? "",
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
