// 书源批量验证：对每个书源执行一次真实搜索，统计可用性。
// 与健康检查（sourceHealth.test.ts）同逻辑，但走生产 httpGet（Rust 网络层，
// 含 cookie jar / 编码回退），供书源管理页"批量验证/删除失败源"使用。
import { httpGet, mergeUserAgent, type BookSource } from "./api";
import { parseBookSourceJson, resolveSearchUrl, extractBookList, hostOf, resolveUrl } from "./bookSourceEngine";

export interface VerifyResult {
  id: number;
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  reason: string;
}

export async function verifySource(bs: BookSource, keyword = "斗破苍穹"): Promise<VerifyResult> {
  const t0 = Date.now();
  const fail = (reason: string): VerifyResult =>
    ({ id: bs.id, name: bs.name, ok: false, count: 0, ms: Date.now() - t0, reason });
  try {
    const src = parseBookSourceJson(bs.json);
    const parsed = resolveSearchUrl(src.searchUrl ?? "", keyword, 1, { sourceKey: src.bookSourceUrl, source: src });
    if (!parsed.url) return fail("无搜索URL");
    const url = resolveUrl(parsed.url, src.bookSourceUrl);
    const html = await httpGet(
      url,
      mergeUserAgent(src.httpHeaders, src.httpUserAgent),
      8000,
      parsed.method,
      parsed.body,
      undefined,
      hostOf(src.bookSourceUrl),
    );
    if (!html || html.length < 80) return fail("响应过短");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = await extractBookList(doc, src.ruleSearch ?? {}, {
      baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl, source: src,
    });
    if (items.length === 0) return fail("无结果");
    return { id: bs.id, name: bs.name, ok: true, count: items.length, ms: Date.now() - t0, reason: "" };
  } catch (e) {
    return fail(String(e).slice(0, 120));
  }
}

export interface VerifyOptions {
  keyword?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number, result: VerifyResult) => void;
  shouldCancel?: () => boolean;
}

/** 并发批量验证，保持输入顺序返回；返回最终结果数组 */
export async function verifySources(sources: BookSource[], opts?: VerifyOptions): Promise<VerifyResult[]> {
  const keyword = opts?.keyword ?? "斗破苍穹";
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 10, sources.length || 1));
  const results: VerifyResult[] = new Array(sources.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < sources.length) {
      if (opts?.shouldCancel?.()) return;
      const i = next++;
      const r = await verifySource(sources[i], keyword);
      results[i] = r;
      done++;
      opts?.onProgress?.(done, sources.length, r);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
