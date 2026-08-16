// 书源批量验证：对每个书源执行一次真实搜索，统计可用性。
// 学习 legado 原版 CheckSource 机制：
// 1) 检测关键字默认 "我的"（原版 CheckSource.keyword），书源可用 ruleSearch.checkKeyWord 覆盖；
// 2) 检测结果写入书源分组（bookSourceGroup）：失败加标记（搜索失效/网站失效/校验超时/js失效/
//    搜索链接规则为空），成功清除全部失效标记 —— 与 legado addGroup/removeInvalidGroups 一致；
// 3) "删除失效源"按含"失效"/"校验超时"的分组筛选（legado getInvalidGroupNames），
//    不依赖当次会话，重启后依然有效。
import { httpGet, mergeUserAgent, updateBookSource, type BookSource } from "./api";
import { parseBookSourceJson, resolveSearchUrl, extractBookList, hostOf, resolveUrl } from "./bookSourceEngine";

export const CHECK_KEYWORD = "我的";

/** 原版 CheckSourceService 写入分组的失败标记（与 legado 文案一致） */
export const FAILURE_GROUPS = [
  "搜索失效", "网站失效", "校验超时", "js失效", "搜索链接规则为空",
  "发现失效", "发现规则为空", "搜索目录失效", "搜索正文失效",
] as const;

/** legado getInvalidGroupNames：分组名含"失效"或等于"校验超时" */
export function isInvalidGroup(group: string): boolean {
  return group.includes("失效") || group === "校验超时";
}

/** 失败原因 → 分组标记（对应原版 addGroup 文案） */
export function failureGroup(reason: string): string {
  if (/无搜索URL|搜索链接/.test(reason)) return "搜索链接规则为空";
  if (/aborted|timed out|超时/i.test(reason)) return "校验超时";
  if (/无结果/.test(reason)) return "搜索失效";
  if (/syntaxerror|referenceerror|typeerror: [a-z] is not|js 失效|java/i.test(reason)) return "js失效";
  return "网站失效";
}

/** 更新书源 JSON 的 bookSourceGroup：先移除全部失效标记，再（可选）加入新标记；解析失败或无变化时返回原 json */
export function updateSourceGroups(json: string, addGroup: string | null): string {
  try {
    const obj = JSON.parse(json);
    const groups = new Set(
      String(obj.bookSourceGroup ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    const oldNorm = String(obj.bookSourceGroup ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",");
    for (const g of FAILURE_GROUPS) groups.delete(g);
    if (addGroup) groups.add(addGroup);
    const newGroupStr = [...groups].join(",");
    if (oldNorm === newGroupStr) return json;
    obj.bookSourceGroup = newGroupStr;
    return JSON.stringify(obj);
  } catch {
    return json;
  }
}

export interface VerifyResult {
  id: number;
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  reason: string;
  /** 检测写入书源分组的标记；成功时为 null（清除历史失效标记） */
  group: string | null;
}

export async function verifySource(bs: BookSource, keyword?: string): Promise<VerifyResult> {
  const t0 = Date.now();
  const fail = (reason: string): VerifyResult =>
    ({ id: bs.id, name: bs.name, ok: false, count: 0, ms: Date.now() - t0, reason, group: failureGroup(reason) });
  try {
    const src = parseBookSourceJson(bs.json);
    // 书源级自定义检测关键字（legado searchRule.checkKeyWord）
    const kw = keyword ?? src.ruleSearch?.checkKeyWord ?? CHECK_KEYWORD;
    const parsed = resolveSearchUrl(src.searchUrl ?? "", kw, 1, { sourceKey: src.bookSourceUrl, source: src });
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
    return { id: bs.id, name: bs.name, ok: true, count: items.length, ms: Date.now() - t0, reason: "", group: null };
  } catch (e) {
    return fail(String(e).slice(0, 120));
  }
}

export interface VerifyOptions {
  keyword?: string;
  concurrency?: number;
  /** 每完成一个书源回调（done, total, result, updatedJson） */
  onProgress?: (done: number, total: number, result: VerifyResult, updatedJson: string) => void;
  shouldCancel?: () => boolean;
  /** 持久化书源分组标记；默认 updateBookSource */
  persist?: (id: number, name: string, url: string, json: string) => Promise<void>;
}

/** 并发批量验证，保持输入顺序返回；检测结果写入书源分组并持久化（legado 机制） */
export async function verifySources(sources: BookSource[], opts?: VerifyOptions): Promise<VerifyResult[]> {
  const keyword = opts?.keyword;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 10, sources.length || 1));
  const persist = opts?.persist ?? ((id, name, url, json) => updateBookSource(id, name, url, json));
  const results: VerifyResult[] = new Array(sources.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < sources.length) {
      if (opts?.shouldCancel?.()) return;
      const i = next++;
      const bs = sources[i];
      const r = await verifySource(bs, keyword);
      results[i] = r;
      // 学习原版：检测结果持久化到书源分组（失败标记 / 清除失效标记）
      const updatedJson = updateSourceGroups(bs.json, r.group);
      if (updatedJson !== bs.json) {
        try { await persist(bs.id, bs.name, bs.url, updatedJson); } catch { /* 持久化失败不影响结果 */ }
      }
      done++;
      opts?.onProgress?.(done, sources.length, r, updatedJson);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** 从书源 JSON 的分组中提取失效分组名（legado getInvalidGroupNames） */
export function invalidGroupNames(json: string): string[] {
  try {
    const obj = JSON.parse(json);
    return String(obj.bookSourceGroup ?? "").split(",")
      .map((s) => s.trim()).filter(Boolean).filter(isInvalidGroup);
  } catch {
    return [];
  }
}
