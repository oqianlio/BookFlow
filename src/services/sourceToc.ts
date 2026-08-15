import { listBookSources, httpGet, mergeUserAgent } from "./api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, type BookSource } from "./bookSourceEngine";

export interface TocItem { name: string; url: string }
export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }
export interface TocResult {
  info: SourceBookInfo;
  toc: TocItem[];
  loginUrl?: string;
}

const cache = new Map<string, Promise<TocResult>>();

export function clearTocCache(): void {
  cache.clear();
}

export async function fetchToc(opts: {
  sourceId: number;
  bookUrl: string;
  initialTitle: string;
}): Promise<TocResult> {
  const key = `${opts.sourceId}:${opts.bookUrl}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = doFetch(opts);
  cache.set(key, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(key); // 失败不缓存
    throw e;
  }
}

async function doFetch(opts: { sourceId: number; bookUrl: string; initialTitle: string }): Promise<TocResult> {
  const bs = (await listBookSources()).find((x) => x.id === opts.sourceId);
  if (!bs) throw new Error("书源不存在");
  const s: BookSource = parseBookSourceJson(bs.json);
  if (!opts.bookUrl) throw new Error("书籍地址无效，无法打开");
  const base = s.bookSourceUrl || opts.bookUrl;
  const resolvedBookUrl = opts.bookUrl.startsWith("http") ? opts.bookUrl : new URL(opts.bookUrl, base).toString();
  let cookieJarHost = "";
  try { cookieJarHost = new URL(s.bookSourceUrl).hostname; } catch { cookieJarHost = s.bookSourceUrl; }
  const html = await httpGet(resolvedBookUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const bi = s.ruleBookInfo ?? {};
  const title = bi.name ? await extractSingle(doc, bi.name, { result: html, sourceKey: s.bookSourceUrl }) : opts.initialTitle;
  const author = bi.author ? await extractSingle(doc, bi.author, { result: html, sourceKey: s.bookSourceUrl }) : "";
  const intro = bi.intro ? await extractSingle(doc, bi.intro, { result: html, sourceKey: s.bookSourceUrl }) : "";
  const cover = bi.coverUrl ? await extractSingle(doc, bi.coverUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl }) : "";
  const tocUrl = bi.tocUrl ? await extractSingle(doc, bi.tocUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl }) : resolvedBookUrl;
  const tocHtml = tocUrl === resolvedBookUrl ? html : await httpGet(tocUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const tocDoc = parseHtml(tocHtml);
  const rules = s.ruleToc ?? {};
  const items = await extractList(tocDoc, rules.chapterList ?? "", {
    name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
  }, { baseUrl: tocUrl, result: tocHtml, sourceKey: s.bookSourceUrl });
  const toc = items.filter((i) => i.url).map((i) => ({
    name: i.name || "未命名章节",
    url: i.url.startsWith("http") ? i.url : new URL(i.url, tocUrl).toString(),
  }));
  return {
    info: { title: title || opts.initialTitle, author, intro, coverUrl: cover },
    toc,
    loginUrl: s.loginUrl,
  };
}
