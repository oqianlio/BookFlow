import { httpGet, listBookSources, mergeUserAgent, type BookSource as ApiBookSource } from "./api";
import { parseHtml, parseBookSourceJson, resolveSearchUrl, extractBookList, type BookSource as Src } from "./bookSourceEngine";

export interface SearchHit {
  title: string; author: string; coverUrl: string; bookUrl: string;
  sourceId: number; sourceName: string;
}

async function searchSource(key: string, bs: ApiBookSource): Promise<SearchHit[]> {
  const src: Src = parseBookSourceJson(bs.json);
  const parsed = resolveSearchUrl(src.searchUrl ?? "", key, 1, { sourceKey: src.bookSourceUrl });
  if (!parsed.url) return [];
  let cookieJarHost = "";
  try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
  const html = await httpGet(parsed.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, parsed.method, parsed.body, undefined, cookieJarHost);
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
