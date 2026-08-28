/**
 * 规则提取模块
 * 负责根据解析后的规则从文档/JSON/元素中提取数据
 */

import { getSourceVars } from "../sourceVars";
import { httpGet, mergeUserAgent } from "../api";
import type {
  ExtractContext,
} from "./ruleParser";
import {
  ABS_URL_RE,
  cachedParseRule,
  resolveUrl,
  isUrlField,
  splitAlternatives,
  parseHtml,
  emptyDoc,
  applyReplacements,
  applyRegexReplace,
  splitReplaceSuffix,
} from "./ruleParser";
import {
  nodeValue,
  selectNodes,
  normalizeSelector,
  queryIndexed,
  resolveTagIndex,
  selectNodesSafe,
} from "./ruleSelector";
import { evalJs, jArr, jsoupNode, type JsContext } from "./jsEvaluator";
import { jsonGet } from "./jsonPath";

// ============ 工具 ============

/** 从书源地址提取 host（cookie jar 键），URL 非法时原样返回 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ============ 变量系统 ============

/** `@get:{key}` / `@get:key` → 变量值；无匹配原样返回（不替换非变量 @ 用法） */
function substituteGetVars(s: string, sourceKey?: string): string {
  if (!s || !s.includes("@get:")) return s;
  const vars = getSourceVars(sourceKey ?? "default");
  return s.replace(/@get:\{([^}]+)\}|@get:([\w-]+)/g, (_m, b1: string, b2: string) => {
    const key = String(b1 ?? b2 ?? "").trim();
    return vars.get(key) ?? "";
  });
}

/**
 * 解析 `@put:` 载荷为 [key, valueRule] 列表。
 * - `@put:{key:value,key2:value2}`：JSON 对象形式，值带引号（值为规则串）；
 *   失败时手动按顶层逗号/冒号拆分（容错无引号键值，如 `@put:{bid:bid}`）。
 * - `@put:key:value`：简单形式。
 * 解析失败返回 null（调用方忽略该块）。
 */
function parsePutPayload(inner: string): Array<[string, string]> | null {
  const s = inner.trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    const objInner = s.slice(1, -1).trim();
    if (objInner) {
      try {
        const obj = JSON.parse(s) as Record<string, unknown>;
        return Object.entries(obj).map(([k, v]) => [k, v == null ? "" : String(v)]);
      } catch {
        // JSON 失败：手动拆分（引号感知顶层逗号 → 首个冒号）
        const entries: Array<[string, string]> = [];
        let i = 0;
        let cur = "";
        let inStr = false;
        while (i <= objInner.length) {
          const ch = i < objInner.length ? objInner[i] : ",";
          if (ch === '"' && objInner[i - 1] !== "\\") inStr = !inStr;
          if (ch === "," && !inStr) {
            const colon = cur.indexOf(":");
            if (colon > 0) entries.push([cur.slice(0, colon).trim().replace(/^"|"$/g, ""), cur.slice(colon + 1).trim().replace(/^"|"$/g, "")]);
            cur = "";
          } else if (i < objInner.length) {
            cur += ch;
          }
          i++;
        }
        return entries.length ? entries : null;
      }
    }
  }
  const m = s.match(/^([^:]+):([\s\S]*)$/);
  if (m) {
    const stripQ = (x: string) => x.trim().replace(/^"(.*)"$/, "$1");
    return [[stripQ(m[1]), stripQ(m[2])]];
  }
  return null;
}

/** 判断 @put 值是否为纯字面量（无规则语法：无选择器/路径/模板/正则/@ 前缀） */
function isPutLiteral(v: string): boolean {
  if (!v) return true;
  return !/[@{}$#.]/.test(v) && !v.includes("{{") && !v.includes("##") && !/^\//.test(v);
}

/**
 * @put 值求值：先按规则求值；结果为空且值本身是纯字面量时存字面量
 * （如 `@put:{bookid:"999"}` → 存 "999"；`@put:{bid:bid}` 且 obj 无 bid → 存 "bid"）。
 */
function evalPutValue(raw: string, evalRule: (r: string) => string): string {
  const v = evalRule(raw);
  if (v) return v;
  return isPutLiteral(raw) ? raw : "";
}

/**
 * 扫描规则串中所有 `@put:{...}` 块（引号感知括号匹配，值内可含 @ 与 :）。
 * 返回块区间与载荷；用于在链/路径解析前剥离并执行副作用。
 */
function findPutBlocks(s: string): Array<{ start: number; end: number; payload: string }> {
  const out: Array<{ start: number; end: number; payload: string }> = [];
  let i = 0;
  while (i < s.length) {
    const idx = s.indexOf("@put:", i);
    if (idx === -1) break;
    const after = idx + 5;
    if (s[after] !== "{") {
      // 简单形式 @put:key:value：到行尾/规则尾（不含后续 @ 链段——简单形式很少见，取到行尾）
      const nl = s.indexOf("\n", after);
      const end = nl === -1 ? s.length : nl;
      out.push({ start: idx, end, payload: s.slice(after, end) });
      i = end;
      continue;
    }
    // 块形式：引号感知括号匹配
    let depth = 0;
    let inStr = false;
    let j = after;
    let closed = -1;
    while (j < s.length) {
      const ch = s[j];
      if (ch === '"' && s[j - 1] !== "\\") inStr = !inStr;
      if (!inStr) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { closed = j; break; }
        }
      }
      j++;
    }
    if (closed === -1) break; // 未闭合：不再扫描
    out.push({ start: idx, end: closed + 1, payload: s.slice(after, closed + 1) });
    i = closed + 1;
  }
  return out;
}

// ============ 提取函数 ============

function finalize(v: string, attr?: string, baseUrl?: string): string {
  if (!v) return "";
  if (attr === "href" || attr === "src") {
    // 剥离 legado 规则选项后缀（如 ##$##,{'webView':true} 替换产生的 ,{...}）
    const commaIdx = v.indexOf(",{");
    if (commaIdx > 0) v = v.slice(0, commaIdx).trim();
    return baseUrl ? resolveUrl(v, baseUrl) : v;
  }
  return v;
}

async function extractSingleInner(doc: Document, rule: string, ctx?: ExtractContext): Promise<string> {
  const alts = splitAlternatives(rule);
  if (alts.length > 1) {
    for (const alt of alts) {
      const v = await extractSingle(doc, alt, ctx);
      if (v) return v;
    }
    return "";
  }
  // `@put:{...}` 块剥离并执行（副作用：值规则求值后存变量）。必须先于链/路径解析，
  // 因为块内值规则含 @ 与 :（如 `[property$=book_name]@content`），不能参与 @ 链拆分。
  const putBlocks = findPutBlocks(rule);
  let putRuleStr = rule;
  if (putBlocks.length) {
    const vars = getSourceVars(ctx?.sourceKey ?? "default");
    for (const block of putBlocks) {
      const entries = parsePutPayload(block.payload);
      if (!entries) continue;
      for (const [k, valueRule] of entries) {
        const v = await (async () => {
          const r = await extractSingleInner(doc, valueRule, ctx);
          return r ? r : isPutLiteral(valueRule) ? valueRule : "";
        })();
        vars.set(k, v);
      }
    }
    putRuleStr = putBlocks.reduce((acc, b) => acc.slice(0, b.start) + acc.slice(b.end), rule);
  }
  // 纯 @put 规则（剥离后为空）→ 返回空
  if (!putRuleStr.trim()) return "";
  // 单独 `@get:{key}` / `@get:key` 规则 → 直接返回变量值
  const getMatch = putRuleStr.trim().match(/^@get:\{([^}]+)\}$|^@get:([\w-]+)$/);
  if (getMatch) {
    const vars = getSourceVars(ctx?.sourceKey ?? "default");
    return vars.get(getMatch[1] ?? getMatch[2] ?? "") ?? "";
  }
  rule = putRuleStr;
  // `{{...}}` 模板求值（legado 三态）：
  // 1. `{{$.xxx}}` JSON 路径 → 从 result 的 JSON 取值（如 tocUrl 的 {{$.resourceID}}）
  // 2. `{{js 表达式}}` → evalJs 求值（如 {{baseUrl.match(/bookId=(\d+)/)[1]}}）
  // 3. `{{regex}}` → 从文本提取（正则分支）
  if (rule.includes("{{") && ctx?.result) {
    // 尝试 JSON 解析：成功则按 JSON 路径模板求值
    let jsonOk = false;
    try {
      JSON.parse(String(ctx.result));
      jsonOk = true;
    } catch {
      jsonOk = false;
    }
    if (jsonOk) {
      try {
        const j = JSON.parse(String(ctx.result));
        const out = rule.replace(/\{\{(.*?)\}\}/g, (_m, inner: string) => {
          try {
            const trimmed = String(inner).trim();
            if (trimmed.startsWith("$")) {
              // `$..xxx` 保留递归标记（legado JsonPath 任意深度）；`$.xxx` 剥 `$.`
              const path = trimmed.startsWith("$..") ? trimmed.slice(1) : trimmed.replace(/^\$\.?/, "");
              const v = jsonGet(j, path);
              return v == null ? "" : String(v);
            }
            // js 表达式模板（如 baseUrl.match(...)）
            const v = evalJs(trimmed, {
              doc: emptyDoc(), result: String(ctx.result), baseUrl: ctx?.baseUrl,
              sourceKey: ctx?.sourceKey, book: ctx?.book,
            });
            return v == null ? "" : String(v);
          } catch {
            return "";
          }
        });
        return out;
      } catch {
        // 回退下方分支
      }
    } else if (rule.includes("{{$")) {
      // result 非 JSON 但模板是 JSON 路径：走下方 regex 分支自然失败，直接返回空
      return "";
    }
  }
  // 规则 `<js>...</js>` 后缀（legado：前段提取值作 result 交给 js 处理，
  // 如 nextContentUrl: `text.下一@href\n<js>...检测.../js>`）
  const jsTagIdx = rule.indexOf("<js>");
  if (jsTagIdx > 0) {
    const jsTagEnd = rule.indexOf("</js>", jsTagIdx);
    if (jsTagEnd !== -1) {
      const base = await extractSingle(doc, rule.slice(0, jsTagIdx), ctx);
      try {
        return String(evalJs(rule.slice(jsTagIdx + 4, jsTagEnd), {
          doc, result: base, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book,
        }) ?? "");
      } catch {
        return "";
      }
    }
  }
  // 链式 css@js:...：先按前段提取，把结果作为 result 交给 js 处理（json 混合走下方 json 分支）
  const jsIdx = rule.indexOf("@js:");
  const trimmed = rule.trimStart();
  if (jsIdx > 0 && !trimmed.startsWith("@Json:") && !trimmed.startsWith("$.") && !trimmed.startsWith("$[")) {
    const base = await extractSingle(doc, rule.slice(0, jsIdx), ctx);
    return String(evalJs(rule.slice(jsIdx + 4), { doc, result: base, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
  }
  const parsed = cachedParseRule(rule);
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
    return String(evalJs(parsed.value, { doc, baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, book: ctx?.book as Record<string, unknown> | undefined }) ?? "");
  }
  if (parsed.type === "json") {
    let j: unknown;
    try { j = JSON.parse(String(ctx?.result ?? "")); } catch { return ""; }
    const jsIdxInner = parsed.value.indexOf("@js:");
    const pathPart = (jsIdxInner > 0 ? parsed.value.slice(0, jsIdxInner) : parsed.value).trim();
    const v = jsonGet(j, pathPart);
    if (v == null) return "";
    if (jsIdxInner > 0) {
      return String(evalJs(parsed.value.slice(jsIdxInner + 4), { doc, baseUrl: ctx?.baseUrl, result: v, sourceKey: ctx?.sourceKey }) ?? "");
    }
    const str = String(v);
    if (str && isUrlField(pathPart) && ctx?.baseUrl && !ABS_URL_RE.test(str)) return resolveUrl(str, ctx.baseUrl);
    return str;
  }
  if (parsed.type === "jsBlock") {
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source as JsContext["source"] };
    const raw = evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as unknown as Record<string, unknown>)._ajaxUrl as string | undefined;
    let jsDoc = ctx?.doc ?? doc;
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const host = ctx?.cookieJar ?? "";
      const html = await httpGet({ url: ajaxUrl, headers, cookieJar: host });
      jsDoc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    // legado 行为：jsBlock 的返回值改写成后续规则的 result（如 result=解码后的 JSON 再走 $.book_list.*）
    const rawStr = raw == null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (rawStr && rawStr !== String(ctx?.result ?? "")) {
      newCtx = { ...(newCtx ?? {}), result: rawStr, sourceKey: ctx?.sourceKey, source: ctx?.source, baseUrl: ctx?.baseUrl, cookieJar: ctx?.cookieJar };
      jsDoc = parseHtml(rawStr);
    }
    // 无后续规则（after 空）时直接返回 jsBlock 结果（如正文规则 <js>…txt;</js>）
    if (!parsed.after) return rawStr;
    return extractSingle(jsDoc, parsed.after, newCtx);
  }
  if (!parsed.value) {
    // 纯属性规则（如 "@text"）：取文档自身（extractSingle 场景少见，返回空）
    return "";
  }
  // 链式 A@B@C（如 class.recommend[-1]@a@text / tag.h1@text@get:{k}）：从文档起逐层下钻
  if (parsed.value.includes("@")) {
    const segs = parsed.value.split("@").map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      const last = segs[segs.length - 1];
      // 链内 @get:{key} / @get:key：结果替换为变量值（legado 链语义 get 覆盖；真实源无 get 后接链段）
      // 注意：split("@") 后链段无 @ 前缀，段形如 `get:{k}`
      const getSeg = segs.findIndex((s) => /^get:\{[\w-]+\}$|^get:[\w-]+$/.test(s));
      if (getSeg !== -1) {
        const m = segs[getSeg].match(/^get:\{([\w-]+)\}$|^get:([\w-]+)$/);
        if (m) {
          const vars = getSourceVars(ctx?.sourceKey ?? "default");
          return vars.get(m[1] ?? m[2] ?? "") ?? "";
        }
      }
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
      for (let i = 1; i < segs.length && cur; i++) {
        if (segs[i] === "%%") {
          cur = cur.previousElementSibling; // legado 前兄弟选择器
        } else {
          cur = queryIndexed(segs[i], cur);
        }
      }
      return cur
        ? finalize(applyReplacements(nodeValue(cur, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl)
        : "";
    }
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, doc) ?? queryIndexed(parsed.value, doc);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
  }
  const node = queryIndexed(parsed.value, doc);
  return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, ctx?.baseUrl) : "";
}

/** extractSingle 导出 wrapper：结果统一替换 `@get:{key}` / `@get:key`（URL/模板内变量） */
export async function extractSingle(doc: Document, rule: string, ctx?: ExtractContext): Promise<string> {
  return substituteGetVars(await extractSingleInner(doc, rule, ctx), ctx?.sourceKey);
}

// ============ 列表提取 ============

export async function extractList(
  doc: Document,
  listRule: string,
  itemRules: Record<string, string>,
  ctx?: ExtractContext,
): Promise<Array<Record<string, string>>> {
  // 链式元素规则（legado A@B@C）：含 @ 且非已知前缀（@xpath/@js/json/纯属性）
  const trimmedList = listRule.trim();
  // legado bookList 支持 && 合并多个列表规则（js 块内的 && 不受影响）
  const masked = trimmedList
    .replace(/<js>[\s\S]*?<\/js>/g, (m) => "x".repeat(m.length))
    .replace(/@js:[\s\S]*$/g, (m) => "x".repeat(m.length));
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
            baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, source: ctx?.source as JsContext["source"],
          });
          const arr = Array.isArray(raw) ? raw : [];
          // js 返回的是 jsoup 包装节点（同一 DOM 元素），或字符串/对象（后续按 json 处理时保持）
          nodes = arr
            .map((x: unknown) => (x && typeof x === "object" && (x as Record<string, unknown>).__jsoup ? x as Element : null))
            .filter((x): x is Element => x !== null);
          continue;
        }
        const next: Element[] = [];
        for (const n of nodes) {
          // legado tag.X 段：取节点内所有指定标签（如 tag.li）
          if (/^tag\.[a-zA-Z][\w-]*$/.test(chain[i])) {
            next.push(...Array.from(n.querySelectorAll(chain[i].slice(4))));
            continue;
          }
          // legado `%%` 段：取每个节点的前一个兄弟元素（prev-sibling）
          if (chain[i] === "%%") {
            const prev = n.previousElementSibling;
            if (prev) next.push(prev);
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
          // 段含索引（如 .clearfix.1 / tag.dl.1）→ 取指定第 N 个；否则取全部匹配
          if (/\.\d+$/.test(chain[i])) {
            // tag.X.N：先用 resolveTagIndex（能正确解析 tag.dl.1），失败再回退 queryIndexed
            const hitTag = resolveTagIndex(chain[i], n);
            if (hitTag) { next.push(hitTag); }
            else {
              const hit = queryIndexed(chain[i], n);
              if (hit) next.push(hit);
            }
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
  const parsed = cachedParseRule(listRule);
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
    let items: unknown[];
    try {
      items = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    } catch {
      items = [];
    }
    // legado 书源常 push JSON.stringify(...) 的字符串项（如番茄聚合 API），逐项解析回对象
    const norm = (item: unknown): unknown => {
      if (typeof item === "string") {
        try { return JSON.parse(item); } catch { return item; }
      }
      return item;
    };
    return items.map((item) => {
      const it = norm(item);
      const out: Record<string, string> = {};
      for (const [key, rule] of Object.entries(itemRules)) out[key] = extractFromJsObject(it, rule, ctx?.baseUrl, ctx?.sourceKey);
      return out;
    });
  }
  if (parsed.type === "json") {
    let j: unknown;
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
    const jsCtx: JsContext = { doc: emptyDoc(), baseUrl: ctx?.baseUrl, result: ctx?.result ?? "", sourceKey: ctx?.sourceKey, source: ctx?.source as JsContext["source"] };
    const raw = evalJs(parsed.value, jsCtx);
    const ajaxUrl = (jsCtx as unknown as Record<string, unknown>)._ajaxUrl as string | undefined;
    let jsDoc = ctx?.doc ?? doc;
    let newCtx = ctx;
    if (ajaxUrl) {
      const headers = mergeUserAgent(ctx?.source?.httpHeaders, ctx?.source?.httpUserAgent);
      const html = await httpGet({ url: ajaxUrl, headers, cookieJar: ctx?.cookieJar ?? "" });
      jsDoc = parseHtml(html);
      newCtx = { ...ctx, result: html };
    }
    // legado 行为：jsBlock 的返回值改写成后续规则的 result（如 result=解码后的 JSON 再走 $.book_list.*）
    const rawStr = raw == null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (rawStr && rawStr !== String(ctx?.result ?? "")) {
      newCtx = { ...(newCtx ?? {}), result: rawStr, sourceKey: ctx?.sourceKey, source: ctx?.source, baseUrl: ctx?.baseUrl, cookieJar: ctx?.cookieJar };
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

// ============ 元素级提取 ============

const HTML_TAG_NAMES = new Set([
  "a","abbr","address","area","article","aside","audio","b","base","bdi","bdo",
  "blockquote","body","br","button","canvas","caption","cite","code","col",
  "colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl",
  "dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2",
  "h3","h4","h5","h6","head","header","hr","html","i","iframe","img","input",
  "ins","kbd","label","legend","li","link","main","map","mark","meta","meter",
  "nav","noscript","object","ol","optgroup","option","output","p","param",
  "picture","pre","progress","q","rp","rt","ruby","s","samp","section","select",
  "small","source","span","strong","sub","summary","sup","table","tbody","td",
  "template","textarea","tfoot","th","thead","time","title","tr","track","u",
  "ul","var","video","wbr",
]);

function extractFromElementInner(el: Element, rule: string, baseUrl?: string, book?: unknown, sourceKey?: string): string {
  // `@put:{...}` 块剥离并执行（值规则相对当前元素求值），如 `a@href@put:{u:text}`
  const putBlocks = findPutBlocks(rule);
  let putRuleStr = rule;
  if (putBlocks.length) {
    const vars = getSourceVars(sourceKey ?? "default");
    for (const block of putBlocks) {
      const entries = parsePutPayload(block.payload);
      if (!entries) continue;
      for (const [k, valueRule] of entries) {
        vars.set(k, evalPutValue(valueRule, (r) => extractFromElementInner(el, r, baseUrl, book, sourceKey)));
      }
    }
    putRuleStr = putBlocks.reduce((acc, b) => acc.slice(0, b.start) + acc.slice(b.end), rule);
  }
  rule = putRuleStr.trim();
  if (!rule) return "";
  // 单独 `@get:{key}` / `@get:key` → 返回变量值
  const getMatch = rule.match(/^@get:\{([^}]+)\}$|^@get:([\w-]+)$/);
  if (getMatch) {
    const vars = getSourceVars(sourceKey ?? "default");
    return vars.get(getMatch[1] ?? getMatch[2] ?? "") ?? "";
  }
  // item 规则 `<js>...</js>` 后缀（legado：前段提取值作 result 交给 js 处理，
  // 如 chapterUrl: `onclick##.*\\((\\d+)\\);##$1\n<js>…book.bookUrl…</js>`）
  const jsIdx = rule.indexOf("<js>");
  if (jsIdx > 0) {
    const jsEnd = rule.indexOf("</js>", jsIdx);
    if (jsEnd !== -1) {
      const base = extractFromElementInner(el, rule.slice(0, jsIdx), baseUrl, book, sourceKey);
      try {
        return String(evalJs(rule.slice(jsIdx + 4, jsEnd), {
          doc: el.ownerDocument ?? emptyDoc(), node: el, result: base, baseUrl, book: book as Record<string, unknown> | undefined,
        }) ?? "");
      } catch {
        return "";
      }
    }
  }
  const alts = splitAlternatives(rule);
  if (alts.length > 1) {
    for (const alt of alts) {
      const v = extractFromElementInner(el, alt, baseUrl, book, sourceKey);
      if (v) return v;
    }
    return "";
  }
  let parsed = cachedParseRule(rule);
  // 修正裸标签词：body/li/div 等纯单词被 parseAttrRule 当属性（value="" attr="word"），
  // 应当作 CSS 标签选择器（如 chapterList:"body" = 取整个 body，不是取 body 属性）。
  // 用 HTML 标签名白名单判断（排除 onclick/class/id 等常见属性）
  if (parsed.type === "css" && !parsed.value && parsed.attr
      && /^[a-zA-Z][\w-]*$/.test(parsed.attr)
      && HTML_TAG_NAMES.has(parsed.attr.toLowerCase())) {
    parsed = { type: "css", value: parsed.attr, attr: "text" };
  }
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
      return String(evalJs(parsed.value, { doc: el.ownerDocument ?? emptyDoc(), node: el, result: "", baseUrl, book: book as Record<string, unknown> | undefined }) ?? "");
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
  // item 内链式规则（legado A@B@C，如 .row@a@text / .item@h3@href / tag.h1@text@get:{k}）：
  // parseAttrRule 已把末尾 @属性 拆到 parsed.attr，这里 value 里剩余的 @ 段逐层下钻
  if (parsed.value.includes("@")) {
    const segs = parsed.value.split("@").map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      const last = segs[segs.length - 1];
      // 链内 @get:{key} / @get:key：结果替换为变量值（legado 链语义 get 覆盖）
      // 注意：split("@") 后链段无 @ 前缀，段形如 `get:{k}`
      const getSeg = segs.findIndex((s) => /^get:\{[\w-]+\}$|^get:[\w-]+$/.test(s));
      if (getSeg !== -1) {
        const m = segs[getSeg].match(/^get:\{([\w-]+)\}$|^get:([\w-]+)$/);
        if (m) {
          const vars = getSourceVars(sourceKey ?? "default");
          return vars.get(m[1] ?? m[2] ?? "") ?? "";
        }
      }
      // 末段 js: → 对下钻到的节点执行 js（node = 当前元素）
      if (last.startsWith("js:")) {
        let cur: Element | null = el;
        for (const seg of segs.slice(0, -1)) {
          if (!cur) return "";
          cur = queryIndexed(seg, cur);
        }
        if (!cur) return "";
        try {
          return String(evalJs(last.slice(3), { doc: el.ownerDocument ?? emptyDoc(), node: cur, result: "", baseUrl, book: book as Record<string, unknown> | undefined }) ?? "");
        } catch {
          return "";
        }
      }
      let cur: Element | null = el;
      for (const seg of segs) {
        if (!cur) return "";
        if (seg === "%%") {
          cur = cur.previousElementSibling;
        } else {
          cur = queryIndexed(seg, cur);
        }
      }
      return cur
        ? finalize(applyReplacements(nodeValue(cur, parsed.attr), parsed.replace), parsed.attr, baseUrl)
        : "";
    }
  }
  if (parsed.value.startsWith("tag.")) {
    const node = resolveTagIndex(parsed.value, el) ?? queryIndexed(parsed.value, el);
    return node ? finalize(applyReplacements(nodeValue(node, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
  }
  const node = queryIndexed(parsed.value, el);
  return node ? finalize(applyReplacements(nodeValue(node as Element, parsed.attr), parsed.replace), parsed.attr, baseUrl) : "";
}

/** item 字段提取 + URL 字段（bookUrl/coverUrl）相对地址解析（regexReplace 等规则产出相对路径） */
function extractItemValue(node: Element, key: string, rule: string, ctx?: ExtractContext): string {
  let v = extractFromElement(node, rule, ctx?.baseUrl, ctx?.book, ctx?.sourceKey);
  if ((key === "bookUrl" || key === "coverUrl") && v && !ABS_URL_RE.test(v)) {
    v = resolveUrl(v, ctx?.baseUrl ?? "");
  }
  return v;
}

// ============ 导出函数 ============

/** extractFromElement 导出 wrapper：结果统一替换 `@get:{key}` / `@get:key`（URL/模板内变量） */
export function extractFromElement(el: Element, rule: string, baseUrl?: string, book?: unknown, sourceKey?: string): string {
  return substituteGetVars(extractFromElementInner(el, rule, baseUrl, book, sourceKey), sourceKey);
}

export function extractFromJsObject(obj: unknown, rule: string, baseUrl?: string, sourceKey?: string): string {
  return extractFromJsonObject(obj, rule, { baseUrl, sourceKey });
}

function extractFromJsonObjectInner(
  obj: unknown,
  rule: string,
  ctx?: { baseUrl?: string; sourceKey?: string; book?: Record<string, unknown> },
): string {
  if (obj == null || typeof obj !== "object") return "";
  let s = rule.trim();
  if (!s) return "";
  // `@put:{...}` 块剥离并执行（值规则相对当前 json object 求值），如 `$.name@put:{bookid:$.id}`
  const putBlocks = findPutBlocks(s);
  if (putBlocks.length) {
    const vars = getSourceVars(ctx?.sourceKey ?? "default");
    for (const block of putBlocks) {
      const entries = parsePutPayload(block.payload);
      if (!entries) continue;
      for (const [k, valueRule] of entries) {
        vars.set(k, evalPutValue(valueRule, (r) => extractFromJsonObjectInner(obj, r, ctx)));
      }
    }
    s = putBlocks.reduce((acc, b) => acc.slice(0, b.start) + acc.slice(b.end), s).trim();
  }
  // 纯 @put 规则 → 返回空
  if (!s) return "";
  // 单独 `@get:{key}` / `@get:key` → 返回变量值
  const getMatch = s.match(/^@get:\{([^}]+)\}$|^@get:([\w-]+)$/);
  if (getMatch) {
    const vars = getSourceVars(ctx?.sourceKey ?? "default");
    return vars.get(getMatch[1] ?? getMatch[2] ?? "") ?? "";
  }
  const jsIdx = s.indexOf("@js:");
  if (jsIdx === 0) {
    return String(evalJs(s.slice(4), { doc: emptyDoc(), result: obj, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
  }
  // `{{...}}` 模板：字面文本 + 求值子规则（legado 常见于 bookUrl 拼 URL、kind 拼状态文本）
  // 如 https://x/{{$.novelId}}?a=1 或 连载{{$..is_finished}}完结,{{$..tag_views##\s##,}}
  // 或 js 表达式 {{baseUrl.match(/bookId=(\d+)/)[1]}}（松鹤庭沐 chapterUrl）
  if (s.includes("{{") && s.includes("}}")) {
    const out = s.replace(/\{\{(.*?)\}\}/g, (_m, inner: string) => {
      try {
        const t = String(inner).trim();
        if (t.startsWith("$") || t.startsWith("@")) {
          return extractFromJsonObject(obj, t, ctx) ?? "";
        }
        // js 表达式模板：evalJs 求值（baseUrl/result/book 等变量可用）
        const v = evalJs(t, {
          doc: emptyDoc(), result: obj, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book,
        });
        return v == null ? "" : String(v);
      } catch {
        return "";
      }
    });
    // 模板求值结果整体走 ## 替换后缀（外层，如 ##连载1|0完结）
    if (out.includes("##")) {
      const { body, replaces } = splitReplaceSuffix(out);
      if (replaces.length) return applyReplacements(body, replaces);
    }
    return out;
  }
  // JSON 字段规则的 `##正则##替换` 后缀（如 $.bookName##\（.*|\(.*|最新章节）
  const { body: pathBody, replaces } = splitReplaceSuffix(s);
  const pathPart = (jsIdx > 0 ? pathBody.slice(0, jsIdx) : pathBody).trim();
  const path = pathPart.startsWith("@Json:")
    ? pathPart.slice(6).trim()
    : pathPart.replace(/^\$\.?/, "");
  const v = jsonGet(obj, path);
  if (jsIdx > 0) {
    return String(evalJs(s.slice(jsIdx + 4), { doc: emptyDoc(), result: v, baseUrl: ctx?.baseUrl, sourceKey: ctx?.sourceKey, book: ctx?.book }) ?? "");
  }
  if (v == null) return "";
  let str = String(v);
  str = applyReplacements(str, replaces.length ? replaces : undefined);
  if (str && isUrlField(path) && ctx?.baseUrl && !ABS_URL_RE.test(str)) return resolveUrl(str, ctx.baseUrl);
  return str;
}

/** extractFromJsonObject 导出 wrapper：结果统一替换 `@get:{key}` / `@get:key` */
export function extractFromJsonObject(
  obj: unknown,
  rule: string,
  ctx?: { baseUrl?: string; sourceKey?: string; book?: Record<string, unknown> },
): string {
  return substituteGetVars(extractFromJsonObjectInner(obj, rule, ctx), ctx?.sourceKey);
}

// ============ 其他导出 ============

/** item 字段提取 */
export async function extractBookList(
  doc: Document,
  rules: Record<string, string>,
  ctx: ExtractContext,
): Promise<Array<Record<string, string>>> {
  const itemRules: Record<string, string> = {};
  for (const k of ["name", "author", "coverUrl", "bookUrl"] as const) {
    if (rules[k]) itemRules[k] = rules[k];
  }
  return await extractList(doc, rules.bookList ?? "", itemRules, { baseUrl: ctx.baseUrl, result: ctx.result, sourceKey: ctx.sourceKey, source: ctx.source, cookieJar: ctx.cookieJar });
}
