import { httpGet, mergeUserAgent, saveCachedChapter, listCachedChapters } from "./api";
import { parseHtml, extractSingle, purifyContent, type BookSource as Src } from "./bookSourceEngine";
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
  let cookieJarHost = "";
  try { cookieJarHost = new URL(src.bookSourceUrl).hostname; } catch { cookieJarHost = src.bookSourceUrl; }
  const cached = new Set((await listCachedChapters(opts.sourceId, opts.bookUrl)).map((c) => c.chapter_url));
  const pending = opts.toc.filter((t) => !cached.has(t.url));
  const total = opts.toc.length;
  let done = total - pending.length;
  let failed = 0;
  for (const t of pending) {
    if (opts.signal?.cancelled) break;
    try {
      const html = await httpGet(t.url, mergeUserAgent(src.httpHeaders, src.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
      const doc = parseHtml(html);
      const rules = src.ruleContent ?? {};
      const text = await extractSingle(doc, rules.content ?? "body", { baseUrl: t.url, result: html, sourceKey: src.bookSourceUrl });
      await saveCachedChapter({
        sourceId: opts.sourceId, bookUrl: opts.bookUrl,
        chapterIndex: opts.toc.findIndex((x) => x.url === t.url),
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
