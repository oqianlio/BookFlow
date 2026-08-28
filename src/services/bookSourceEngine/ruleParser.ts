/**
 * 规则解析模块
 * 负责解析 legado 书源规则字符串为结构化的 ParsedRule 对象
 */

// ============ 类型定义 ============

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
  ruleExplore?: BookSourceRules;
  bookUrlPattern?: string;
  ruleSearch?: BookSourceRules;
  ruleBookInfo?: BookSourceRules;
  ruleToc?: BookSourceRules;
  ruleContent?: BookSourceRules;
  [key: string]: unknown;
}

export interface BookSourceRules {
  bookList?: string;
  name?: string;
  author?: string;
  coverUrl?: string;
  bookUrl?: string;
  tocUrl?: string;
  toc?: string;
  nextTocUrl?: string;
  content?: string;
  [key: string]: string | undefined;
}

export interface ExtractContext {
  doc?: Document;
  baseUrl?: string;
  result?: unknown;
  sourceKey?: string;
  source?: BookSource;
  /** cookie jar 键（书源域名），与 httpGet 的 cookieJar 参数对齐 */
  cookieJar?: string;
  /** 当前书籍信息（legado js 上下文 book：bookUrl/tocUrl/name/author 等），注入 evalJs */
  book?: BookInfo;
}

export interface BookInfo {
  bookUrl?: string;
  tocUrl?: string;
  name?: string;
  author?: string;
  [key: string]: unknown;
}

// ============ 规则解析 ============

/** 拆分 legado `##正则##替换` 链式替换后缀（返回提取规则体 + 替换对列表） */
export function splitReplaceSuffix(s: string): { body: string; replaces: Array<[string, string]> } {
  const trimmed = s.trim();
  if (!trimmed.includes("##")) return { body: trimmed, replaces: [] };
  const parts = trimmed.split("##");
  if (parts.length < 2) return { body: trimmed, replaces: [] };
  const body = parts[0].trim();
  if (parts.length === 2) {
    // `body##正则`：只有正则无替换 = 删除匹配（legado replacement 为空）
    return { body, replaces: [[parts[1], ""]] };
  }
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
  // 无 `$` 前缀的 JSON 路径（legado JSON 源可省略 $，如 data.state[*] / list[0] / arr[?(@.x==1)]）：
  // 仅当含 JSON 特有的括号写法（[*]、范围切片、过滤）才判定为 JSON；
  // [N] / [-N] 与 CSS 类/标签下标选择器（class.recommend[0] / tag.li[-1]）歧义，不触发 JSON
  if (/\[(?:\*|-?\d+:-?\d+|\?\()[^\]]*\]/.test(s) && !/^\s*@/.test(s)) {
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

// ============ 规则 AST 缓存（避免重复 parseRule）======

const parsedRuleCache = new Map<string, ParsedRule>();

/** 带缓存的 parseRule（内部用）：相同规则字符串只解析一次 */
export function cachedParseRule(rule: string): ParsedRule {
  let cached = parsedRuleCache.get(rule);
  if (!cached) {
    cached = parseRule(rule);
    parsedRuleCache.set(rule, cached);
    if (parsedRuleCache.size > 5000) parsedRuleCache.clear(); // 防缓存无限增长
  }
  return cached;
}

/** resetRuleCache 供测试用 */
export function resetRuleCache(): void { parsedRuleCache.clear(); }

// ============ 工具函数 ============

export const ABS_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveUrl(href: string, baseUrl: string): string {
  if (ABS_URL_RE.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function isUrlField(path: string): boolean {
  return path.endsWith("bookUrl") || path.endsWith("coverUrl") || path.endsWith("thumb_url") || path.endsWith("cover_url") || path.endsWith("tocUrl") || path.endsWith("toc_url");
}

export function splitAlternatives(rule: string): string[] {
  return rule.split("||").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function emptyDoc(): Document {
  return new DOMParser().parseFromString("", "text/html");
}

export function parseBookSourceJson(raw: string): BookSource {
  const obj = JSON.parse(raw);
  if (!obj.bookSourceUrl || !obj.bookSourceName) {
    throw new Error("书源缺少 bookSourceUrl 或 bookSourceName");
  }
  return obj as BookSource;
}

// ============ 应用替换 ============

/** 应用 legado `##正则##替换` 链式替换；非法正则跳过（保留原值） */
export function applyReplacements(v: string, replaces?: Array<[string, string]>): string {
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
export function applyRegexReplace(source: string, parsed: ParsedRule): string {
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
