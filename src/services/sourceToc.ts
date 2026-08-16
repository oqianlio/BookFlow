import { listBookSources, httpGet, mergeUserAgent } from "./api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, hostOf, type BookSource } from "./bookSourceEngine";

export interface TocItem { name: string; url: string }
export interface SourceBookInfo { title: string; author: string; intro: string; coverUrl: string }
export interface TocResult {
  info: SourceBookInfo;
  toc: TocItem[];
  loginUrl?: string;
}

// 目录缓存：TTL 内复用（连载书目录会更新，长期不失效会看不到新章节）
const cache = new Map<string, { at: number; p: Promise<TocResult> }>();
const TTL_MS = 10 * 60 * 1000; // 10 分钟

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
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = doFetch(opts);
  cache.set(key, { at: Date.now(), p });
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
  const cookieJarHost = hostOf(s.bookSourceUrl);
  const html = await httpGet(resolvedBookUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const bi = s.ruleBookInfo ?? {};
  // legado js 上下文 book 对象（chapterUrl 等规则可能引用 book.bookUrl/tocUrl）
  const book = { bookUrl: resolvedBookUrl, name: opts.initialTitle, tocUrl: "" };
  const title = bi.name ? await extractSingle(doc, bi.name, { result: html, sourceKey: s.bookSourceUrl, book }) : opts.initialTitle;
  const author = bi.author ? await extractSingle(doc, bi.author, { result: html, sourceKey: s.bookSourceUrl, book }) : "";
  const intro = bi.intro ? await extractSingle(doc, bi.intro, { result: html, sourceKey: s.bookSourceUrl, book }) : "";
  const cover = bi.coverUrl ? await extractSingle(doc, bi.coverUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl, book }) : "";
  // tocUrl 规则可能提取为空（页面无该链接）：回退到书籍页本身，避免空 URL 请求
  const tocUrl = (bi.tocUrl ? await extractSingle(doc, bi.tocUrl, { baseUrl: resolvedBookUrl, result: html, sourceKey: s.bookSourceUrl, book }) : "") || resolvedBookUrl;
  const tocHtml = tocUrl === resolvedBookUrl ? html : await httpGet(tocUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const tocDoc = parseHtml(tocHtml);
  const rules = s.ruleToc ?? {};
  const tocBook = { ...book, name: title, author, tocUrl };
  // 目录分页（legado ruleToc.nextTocUrl）：循环抓取下一页合并，防死循环（上限 50 页 + URL 去重）
  const toc: TocItem[] = [];
  const seenChapter = new Set<string>();
  const seenPage = new Set<string>([tocUrl]);
  let curUrl = tocUrl;
  let curHtml = tocHtml;
  for (let page = 0; page < 50; page++) {
    const curDoc = page === 0 ? tocDoc : parseHtml(curHtml);
    const items = await extractList(curDoc, rules.chapterList ?? "", {
      name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
    }, { baseUrl: curUrl, result: curHtml, sourceKey: s.bookSourceUrl, book: tocBook });
    for (const it of items) {
      if (!it.url) continue;
      const abs = it.url.startsWith("http") ? it.url : new URL(it.url, curUrl).toString();
      if (seenChapter.has(abs)) continue;
      seenChapter.add(abs);
      toc.push({ name: it.name || "未命名章节", url: abs });
    }
    if (!rules.nextTocUrl || page >= 49) break;
    const next = (await extractSingle(curDoc, rules.nextTocUrl, {
      baseUrl: curUrl, result: curHtml, sourceKey: s.bookSourceUrl, book: tocBook,
    }))?.trim();
    if (!next) break;
    const nextUrl = next.startsWith("http") ? next : new URL(next, curUrl).toString();
    if (seenPage.has(nextUrl)) break; // 防循环
    seenPage.add(nextUrl);
    curUrl = nextUrl;
    curHtml = await httpGet(nextUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  }
  return {
    info: { title: title || opts.initialTitle, author, intro, coverUrl: cover },
    toc,
    loginUrl: s.loginUrl,
  };
}
