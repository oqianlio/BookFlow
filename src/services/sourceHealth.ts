// 书源健康检查：验证搜索/目录/正文三环可用率，供书源管理界面调用
import { httpGet, listBookSources, mergeUserAgent, HTTP_TIMEOUT_HEALTH, type BookSource } from "./api";
import { parseBookSourceJson, parseHtml, extractSingle, hostOf } from "./bookSourceEngine";
import { fetchTocBySource } from "./sourceToc";

export interface SourceHealth {
  sourceId: number;
  name: string;
  searchOk: boolean;
  tocOk: boolean | "norule";
  contentOk: boolean | "norule";
  error?: string;
}

/** 检查单个书源的搜索/目录/正文状态（复用真实链路） */
async function checkSource(source: BookSource, keyword = "我的"): Promise<SourceHealth> {
  const result: SourceHealth = {
    sourceId: source.id,
    name: source.name,
    searchOk: false,
    tocOk: "norule",
    contentOk: "norule",
  };

  try {
    const src = parseBookSourceJson(source.json);
    if (!src.searchUrl) { result.error = "无搜索规则"; return result; }

    // 1. 搜索（走 Tauri httpGet：带 cookie jar / UA / 超时，与其他服务一致）
    const searchUrl = src.searchUrl.replace(/\{\{key\}\}/g, encodeURIComponent(keyword));
    const searchHtml = await httpGet({
      url: searchUrl,
      headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent),
      timeoutMs: HTTP_TIMEOUT_HEALTH,
      cookieJar: hostOf(src.bookSourceUrl),
    }).catch(() => "");
    if (!searchHtml || searchHtml.length < 50) { result.error = "搜索无结果"; return result; }

    // 2. 用真实链路获取目录（fetchTocBySource）
    const toc = await fetchTocBySource(src, searchUrl, keyword);
    if (toc.toc.length === 0) { result.error = "目录为空"; return result; }
    result.searchOk = true;
    result.tocOk = toc.toc.length > 0;

    // 3. 正文
    if (src.ruleContent?.content) {
      const chapterUrl = toc.toc[0]?.url;
      if (chapterUrl) {
        const contentHtml = await httpGet({
          url: chapterUrl,
          headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent),
          timeoutMs: HTTP_TIMEOUT_HEALTH,
          cookieJar: hostOf(src.bookSourceUrl),
        }).catch(() => "");
        const doc = parseHtml(contentHtml);
        const content = await extractSingle(doc, src.ruleContent.content, { baseUrl: chapterUrl, result: contentHtml, sourceKey: src.bookSourceUrl });
        result.contentOk = (content ?? "").trim().length > 0;
      }
    }
  } catch (e) {
    result.error = String(e).slice(0, 80);
  }

  return result;
}

/** 批量检查所有启用的书源健康状态 */
export async function checkAllSources(
  keyword = "我的",
  onProgress?: (done: number, total: number) => void,
): Promise<SourceHealth[]> {
  const sources = (await listBookSources()).filter(s => s.enabled);
  const results: SourceHealth[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(s => checkSource(s, keyword))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
    onProgress?.(Math.min(i + BATCH_SIZE, sources.length), sources.length);
  }

  return results;
}
