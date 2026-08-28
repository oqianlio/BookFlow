/**
 * 搜索和探索模块
 * 负责处理搜索URL解析和探索页解析
 */

import iconv from "iconv-lite";
import { evalJs } from "./jsEvaluator";
import { emptyDoc } from "./ruleParser";

// ============ 搜索功能 ============

/** 按书源 charset 编码搜索关键词：gbk/gb2312 用 iconv 编码后 %XX，默认 UTF-8 */
function encodeKeyByCharset(key: string, charset?: string): string {
  const c = (charset ?? "utf-8").trim().toLowerCase();
  if (c === "gbk" || c === "gb2312" || c === "gb18030") {
    try {
      const buf = (iconv as unknown as { encode: (s: string, enc: string) => Uint8Array }).encode(key, "gbk");
      let out = "";
      for (const b of buf) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      return out;
    } catch {
      return encodeURIComponent(key);
    }
  }
  return encodeURIComponent(key);
}

export interface SearchResult {
  url: string;
  method?: string;
  body?: string;
  charset?: string;
}

export function parseSearchUrl(searchUrl: string, key: string, page?: number): SearchResult {
  const p = page ?? 1;
  const replaceVars = (s: string, encKey: string) =>
    s.replace(/\{\{key\}\}/g, encKey).replace(/\{\{page\}\}/g, String(p));
  const commaIdx = searchUrl.indexOf(",{");
  if (commaIdx === -1) {
    return { url: replaceVars(searchUrl, encodeURIComponent(key)) };
  }
  const url = searchUrl.slice(0, commaIdx);
  try {
    const opts = JSON.parse(searchUrl.slice(commaIdx + 1));
    const charset = typeof opts.charset === "string" ? opts.charset : undefined;
    const encKey = encodeKeyByCharset(key, charset);
    const body = replaceVars(opts.body ?? "", encKey);
    const urlWithKey = replaceVars(url, encKey);
    return { url: urlWithKey, method: opts.method ?? "POST", body, charset };
  } catch {
    return { url: replaceVars(searchUrl, encodeURIComponent(key)) };
  }
}

export function resolveSearchUrl(searchUrl: string, key: string, page: number, ctx?: { sourceKey?: string; source?: Record<string, unknown> }): SearchResult {
  const s = searchUrl.trim();
  if (s.startsWith("@js:")) {
    const url = String(evalJs(s.slice(4), {
      doc: emptyDoc(), key, page, result: "",
      sourceKey: ctx?.sourceKey, source: ctx?.source,
    }) ?? "");
    // jsBlock 可能产出 legado 的 "URL,{json 请求选项}" 形式（如 url="https://x/search/,"+JSON.stringify({method:"POST",body})）
    return parseSearchUrl(url, key, page);
  }
  return parseSearchUrl(s, key, page);
}

// ============ 探索功能 ============

interface ExploreItem {
  title: string;
  url: string;
}

function parseJsonExplore(raw: unknown): ExploreItem[] | null {
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
      title: String((item as Record<string, unknown>)?.title ?? (item as Record<string, unknown>)?.name ?? ""),
      url: String((item as Record<string, unknown>)?.url ?? ""),
    }))
    .filter((k) => k.url);
}

export function parseExploreUrl(
  exploreUrl: string,
  ctx?: { sourceKey?: string; source?: Record<string, unknown> },
): ExploreItem[] {
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
