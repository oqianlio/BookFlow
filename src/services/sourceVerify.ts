// 书源批量验证：对每个书源执行真实搜索 +（可选）目录/正文校验。
// 学习 legado 原版 CheckSourceService 机制：
// 1) 检测关键字默认 "我的"（原版 CheckSource.keyword），书源可用 ruleSearch.checkKeyWord 覆盖；
// 2) 检测项：搜索 / 目录 / 正文（对应原版 checkSearch/checkCategory/checkContent，默认全开）；
//    搜索成功取第一本书，继续校验 ruleToc 目录与 ruleContent 正文（原版 checkBook）；
// 3) 检测结果写入书源分组（bookSourceGroup）：失败加标记（搜索失效/网站失效/校验超时/
//    js失效/搜索链接规则为空/搜索目录失效/搜索正文失效），成功清除全部失效标记；
// 4) "删除失效源"按含"失效"/"校验超时"的分组筛选（legado getInvalidGroupNames）。
import { httpGet, mergeUserAgent, updateBookSource, HTTP_TIMEOUT_HEALTH, type BookSource } from "./api";
import { parseBookSourceJson, parseHtml, resolveSearchUrl, extractBookList, extractSingle, hostOf, resolveUrl, type BookSource as Src } from "./bookSourceEngine";
import { fetchTocBySource } from "./sourceToc";

export const CHECK_KEYWORD = "我的";

/** 搜索响应判定有效的最小 HTML 长度 */
const MIN_SEARCH_HTML_LENGTH = 80;
/** 正文判定有效的最小字符数 */
const MIN_CONTENT_LENGTH = 30;

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
export function updateSourceGroups(json: string, addGroups: string[] | null): string {
  try {
    const obj = JSON.parse(json);
    const groups = new Set(
      String(obj.bookSourceGroup ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    const oldNorm = String(obj.bookSourceGroup ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",");
    for (const g of FAILURE_GROUPS) groups.delete(g);
    if (addGroups) for (const g of addGroups) groups.add(g);
    const newGroupStr = [...groups].join(",");
    if (oldNorm === newGroupStr) return json;
    obj.bookSourceGroup = newGroupStr;
    return JSON.stringify(obj);
  } catch {
    return json;
  }
}

/** 写回响应耗时（legado BookSource.respondTime，毫秒，用于按响应速度排序）；解析失败或无变化时返回原 json */
export function updateRespondTime(json: string, ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return json;
  try {
    const obj = JSON.parse(json);
    if (obj.respondTime === ms) return json;
    obj.respondTime = Math.round(ms);
    return JSON.stringify(obj);
  } catch {
    return json;
  }
}

/** 从书源 JSON 读取响应耗时（毫秒；无则返回 null） */
export function respondTimeOf(json: string): number | null {
  try {
    const v = JSON.parse(json).respondTime;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** 检测项开关（对应原版 CheckSource.checkSearch/checkCategory/checkContent） */
export interface VerifyChecks {
  search?: boolean;
  toc?: boolean;
  content?: boolean;
}

export interface VerifyResult {
  id: number;
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  reason: string;
  /** 检测写入书源分组的失败标记；成功（含清除历史标记）时为 [] */
  groups: string[];
}

export interface VerifySourceOptions {
  keyword?: string;
  checks?: VerifyChecks;
}

/**
 * 校验目录与正文（原版 checkBook）：
 * 取第一本书 → 走真实目录链路（fetchTocBySource：bookUrl→ruleBookInfo→tocUrl→目录，
 * 与阅读页共用，JSON API 源不再误报）→ 若启用了正文检测，取第一章提取 ruleContent 正文。
 * 返回失败标记数组（原版文案："搜索目录失效" / "搜索正文失效"）。
 */
async function checkTocAndContent(src: Src, bookUrl: string, checks: VerifyChecks): Promise<string[]> {
  const marks: string[] = [];
  try {
    // 真实链路（与 fetchToc/阅读页一致）
    const r = await fetchTocBySource(src, bookUrl, "校验");
    const toc = r.toc;
    if (checks.toc && toc.length === 0) {
      marks.push("搜索目录失效");
      return marks;
    }
    if (checks.content && src.ruleContent?.content && toc.length > 0) {
      const chUrl = toc[0].url;
      const cookieJarHost = hostOf(src.bookSourceUrl);
      const ua = mergeUserAgent(src.httpHeaders, src.httpUserAgent);
      const chHtml = await httpGet({ url: chUrl, headers: ua, timeoutMs: HTTP_TIMEOUT_HEALTH, cookieJar: cookieJarHost });
      const chDoc = parseHtml(chHtml);
      const content = await extractSingle(chDoc, src.ruleContent.content, {
        baseUrl: chUrl, result: chHtml, sourceKey: src.bookSourceUrl, source: src,
      });
      if (!content || content.trim().length < MIN_CONTENT_LENGTH) marks.push("搜索正文失效");
    }
  } catch {
    // 网络失败 → 目录环节失败（分类由外层 reason 判定）
    marks.push("搜索目录失效");
  }
  return marks;
}

export async function verifySource(bs: BookSource, opts?: VerifySourceOptions): Promise<VerifyResult> {
  const t0 = Date.now();
  const checks: VerifyChecks = { search: true, toc: true, content: true, ...(opts?.checks ?? {}) };
  const fail = (reason: string, extra: string[] = []): VerifyResult =>
    ({ id: bs.id, name: bs.name, ok: false, count: 0, ms: Date.now() - t0, reason, groups: [failureGroup(reason), ...extra] });
  try {
    const src = parseBookSourceJson(bs.json);
    // 书源级自定义检测关键字（legado searchRule.checkKeyWord）
    const kw = opts?.keyword ?? src.ruleSearch?.checkKeyWord ?? CHECK_KEYWORD;
    const parsed = resolveSearchUrl(src.searchUrl ?? "", kw, 1, { sourceKey: src.bookSourceUrl, source: src });
    if (!parsed.url) return fail("无搜索URL");
    const url = resolveUrl(parsed.url, src.bookSourceUrl);
    const html = await httpGet({
      url,
      headers: mergeUserAgent(src.httpHeaders, src.httpUserAgent),
      timeoutMs: HTTP_TIMEOUT_HEALTH,
      method: parsed.method,
      body: parsed.body,
      cookieJar: hostOf(src.bookSourceUrl),
    });
    if (!html || html.length < MIN_SEARCH_HTML_LENGTH) return fail("响应过短");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = await extractBookList(doc, (src.ruleSearch ?? {}) as Record<string, string>, {
      baseUrl: src.bookSourceUrl, result: html, sourceKey: src.bookSourceUrl, source: src,
    });
    if (items.length === 0) return fail("无结果");
    // 学习原版：搜索到书后继续校验目录/正文（仅当源配置了对应规则且检测项启用）。
    // ok 由搜索判定：轻量检测无 Referer/cookie 全流程，详情页常因网络/反爬失败，
    // 若目录/正文失败即判失效会大量误杀可用源（真实源实测 72→9）。
    // 目录/正文失败作为质量标记附加，源仍算可用。
    const hasTocRule = !!(src.ruleToc?.chapterList) && (checks.toc || checks.content);
    if (hasTocRule && items[0]?.bookUrl) {
      const marks = await checkTocAndContent(src, items[0].bookUrl, checks);
      if (marks.length > 0) {
        return { id: bs.id, name: bs.name, ok: true, count: items.length, ms: Date.now() - t0, reason: marks.join("、"), groups: marks };
      }
    }
    return { id: bs.id, name: bs.name, ok: true, count: items.length, ms: Date.now() - t0, reason: "", groups: [] };
  } catch (e) {
    return fail(String(e).slice(0, 120));
  }
}

export interface VerifyOptions extends VerifySourceOptions {
  concurrency?: number;
  /** 每完成一个书源回调（done, total, result, updatedJson） */
  onProgress?: (done: number, total: number, result: VerifyResult, updatedJson: string) => void;
  shouldCancel?: () => boolean;
  /** 持久化书源分组标记；默认 updateBookSource */
  persist?: (id: number, name: string, url: string, json: string) => Promise<void>;
}

/** 并发批量验证，保持输入顺序返回；检测结果写入书源分组并持久化（legado 机制）。
 *  同域名（同服务商）源串行执行 + 间隔，避免触发服务商限流误报（lessons 3.40）。 */
export async function verifySources(sources: BookSource[], opts?: VerifyOptions): Promise<VerifyResult[]> {
  const persist = opts?.persist ?? ((id, name, url, json) => updateBookSource(id, name, url, json));
  const results: VerifyResult[] = new Array(sources.length);
  const done = { n: 0 };
  const runOne = async (i: number, bs: BookSource) => {
    if (opts?.shouldCancel?.()) return;
    const r = await verifySource(bs, { keyword: opts?.keyword, checks: opts?.checks });
    results[i] = r;
    // 学习原版：检测结果持久化到书源分组（失败标记 / 清除失效标记）+ 响应耗时（respondTime）
    let updatedJson = updateSourceGroups(bs.json, r.groups.length > 0 ? r.groups : null);
    if (r.ok) updatedJson = updateRespondTime(updatedJson, r.ms);
    if (updatedJson !== bs.json) {
      try { await persist(bs.id, bs.name, bs.url, updatedJson); } catch { /* 持久化失败不影响结果 */ }
    }
    done.n++;
    opts?.onProgress?.(done.n, sources.length, r, updatedJson);
  };
  // 按域名分组：同域名串行（组内 200ms 间隔），组间并发（上限 concurrency）
  const groups = new Map<string, Array<{ i: number; bs: BookSource }>>();
  for (let i = 0; i < sources.length; i++) {
    let host = "unknown";
    try { host = hostOf(sources[i].url || (JSON.parse(sources[i].json) as { bookSourceUrl?: string }).bookSourceUrl || ""); } catch { /* 保持 unknown */ }
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host)!.push({ i, bs: sources[i] });
  }
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 10, groups.size || 1));
  const hosts = [...groups.keys()];
  let nextHost = 0;
  const hostWorker = async () => {
    while (nextHost < hosts.length) {
      if (opts?.shouldCancel?.()) return;
      const host = hosts[nextHost++];
      for (const { i, bs } of groups.get(host)!) {
        await runOne(i, bs);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, hostWorker));
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
