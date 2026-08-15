import { parseBookSourceJson, parseHtml, extractSingle, extractList, resolveSearchUrl, type BookSource as Src } from "./bookSourceEngine";
import { httpGet, mergeUserAgent } from "./api";

export interface DebugResult {
  html: string;
  fields: Array<{ name: string; value: string }>;
}

export async function debugSource(
  bs: { json: string },
  stage: "search" | "toc" | "content",
  urlOrKey: string,
): Promise<DebugResult> {
  const src: Src = parseBookSourceJson(bs.json);
  const ua = mergeUserAgent(src.httpHeaders, src.httpUserAgent);
  let host = "";
  try { host = new URL(src.bookSourceUrl).hostname; } catch { /* ignore */ }

  let html: string;
  if (stage === "search") {
    const parsed = resolveSearchUrl(src.searchUrl ?? "", urlOrKey, 1, { sourceKey: src.bookSourceUrl, source: src });
    html = await httpGet(parsed.url, ua, undefined, parsed.method, parsed.body, undefined, host);
  } else {
    html = await httpGet(urlOrKey, ua, undefined, undefined, undefined, undefined, host);
  }
  const doc = parseHtml(html);
  const ctx = { baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl };
  const fields: Array<{ name: string; value: string }> = [];

  if (stage === "search") {
    for (const k of ["bookList", "name", "author", "coverUrl", "bookUrl"]) {
      const rule = src.ruleSearch?.[k];
      if (!rule) continue;
      let v: string;
      if (k === "bookList") {
        const items = await extractList(doc, rule, { name: "a@text", author: "a@text", bookUrl: "a@href" }, ctx);
        v = JSON.stringify(items).slice(0, 200);
      } else {
        v = await extractSingle(doc, rule, ctx);
      }
      fields.push({ name: k, value: v });
    }
  } else if (stage === "toc") {
    for (const k of ["name", "author", "intro", "tocUrl"]) {
      const rule = src.ruleBookInfo?.[k];
      if (!rule) continue;
      fields.push({ name: k, value: await extractSingle(doc, rule, ctx) });
    }
    for (const k of ["chapterList", "chapterName", "chapterUrl"]) {
      const rule = src.ruleToc?.[k];
      if (!rule) continue;
      let v: string;
      if (k === "chapterList") {
        const items = await extractList(doc, rule, { name: "@text", url: "@href" }, ctx);
        v = JSON.stringify(items).slice(0, 200);
      } else {
        v = await extractSingle(doc, rule, ctx);
      }
      fields.push({ name: k, value: v });
    }
  } else {
    for (const k of ["content", "nextContentUrl"]) {
      const rule = src.ruleContent?.[k];
      if (!rule) continue;
      fields.push({ name: k, value: await extractSingle(doc, rule, ctx) });
    }
  }

  return { html: html.slice(0, 500), fields };
}
