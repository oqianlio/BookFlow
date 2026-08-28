import { httpGet, mergeUserAgent, saveCachedChapter, listCachedChapters } from "./api";
import { parseHtml, extractSingle, purifyContent, hostOf, type BookSource as Src } from "./bookSourceEngine";
import type { TocItem } from "./sourceToc";

export interface DownloadProgress { done: number; total: number; failed: number }

export interface DownloadOpts {
  sourceId: number;
  bookUrl: string;
  toc: TocItem[];
  getSrc: () => Promise<Src>;
  onProgress: (p: DownloadProgress) => void;
  signal?: { cancelled: boolean };
}

export async function downloadBook(opts: DownloadOpts): Promise<DownloadProgress> {
  const src = await opts.getSrc();
  const cookieJarHost = hostOf(src.bookSourceUrl);
  const cached = new Set((await listCachedChapters(opts.sourceId, opts.bookUrl)).map((c) => c.chapter_url));
  // 预建 url → 目录索引，避免逐章 findIndex 的 O(n²)
  const indexOf = new Map(opts.toc.map((t, i) => [t.url, i]));
  const pending = opts.toc.filter((t) => !cached.has(t.url));
  const total = opts.toc.length;
  let done = total - pending.length;
  let failed = 0;
  for (const t of pending) {
    if (opts.signal?.cancelled) break;
    try {
      const html = await httpGet({ url: t.url, headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent), cookieJar: cookieJarHost });
      const doc = parseHtml(html);
      const rules = src.ruleContent ?? {};
      const text = await extractSingle(doc, rules.content ?? "body", { baseUrl: t.url, result: html, sourceKey: src.bookSourceUrl });
      await saveCachedChapter({
        sourceId: opts.sourceId, bookUrl: opts.bookUrl,
        chapterIndex: indexOf.get(t.url) ?? 0,
        chapterUrl: t.url, chapterName: t.name,
        content: purifyContent(text, (src as any).purify),
      });
      done += 1;
    } catch {
      failed += 1;
    }
    opts.onProgress({ done, total, failed });
  }
  opts.onProgress({ done, total, failed });
  return { done, total, failed };
}
