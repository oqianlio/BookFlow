import { httpGet, listBookSources, mergeUserAgent, type BookSource as ApiBookSource } from "./api";
import { parseHtml, parseBookSourceJson, resolveSearchUrl, extractBookList, hostOf, resolveUrl, type BookSource as Src } from "./bookSourceEngine";

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
  const html = await httpGet(url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), 10000, parsed.method, parsed.body, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const rules = src.ruleSearch ?? {};
  const items = await extractBookList(doc, rules, { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl });
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
