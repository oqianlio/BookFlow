import { httpGet, listBookSources, mergeUserAgent, HTTP_TIMEOUT_SEARCH, type BookSource as ApiBookSource } from "./api";
import { parseHtml, parseBookSourceJson, resolveSearchUrl, extractBookList, hostOf, resolveUrl, type BookSource as Src, type ExtractContext } from "./bookSourceEngine";
import { applyInitRule } from "./sourceToc";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: ApiBookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1, { sourceKey: src.bookSourceUrl, source: src });
  if (!parsed.url) return [];
  // 相对 searchUrl（如 /search/）基于书源域名解析成绝对 URL
  const url = resolveUrl(parsed.url, src.bookSourceUrl);
  const cookieJarHost = hostOf(src.bookSourceUrl);
  const html = await httpGet({ url, headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent), timeoutMs: HTTP_TIMEOUT_SEARCH, method: parsed.method, body: parsed.body, cookieJar: cookieJarHost });
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  // ruleSearch.init（legado）：JSON 路径取子对象 / @put:@get 落变量
  const ctx: ExtractContext = { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl, source: src };
  const initSearch = applyInitRule(doc, rules.init, html, ctx);
  const searchResult = typeof initSearch === "string" ? initSearch : await initSearch;
  const items = await extractBookList(doc, rules as Record<string, string>, { ...ctx, result: searchResult });
  return items.filter((i) => i.name).map((i) => ({
    title: i.name || "未命名", author: i.author ?? "", coverUrl: i.coverUrl ?? "",
    bookUrl: i.bookUrl ?? "", sourceId: bs.id, sourceName: bs.name,
  }));
}

export async function searchBookSources(query: string, opts?: { sourceIds?: number[] }): Promise<SearchHit[]> {
  const sources = (await listBookSources()).filter((s) => s.enabled);
  const targets = opts?.sourceIds ? sources.filter((s) => opts.sourceIds!.includes(s.id)) : sources;
  const all = await Promise.all(targets.map((s) => searchSource(query.trim(), s).catch(() => [] as SearchHit[])));
  return all.flat();
}
