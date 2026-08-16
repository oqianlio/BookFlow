// 书源批量验证：对每个书源执行真实搜索 +（可选）目录/正文校验。
// 学习 legado 原版 CheckSourceService 机制：
// 1) 检测关键字默认 "我的"（原版 CheckSource.keyword），书源可用 ruleSearch.checkKeyWord 覆盖；
// 2) 检测项：搜索 / 目录 / 正文（对应原版 checkSearch/checkCategory/checkContent，默认全开）；
//    搜索成功取第一本书，继续校验 ruleToc 目录与 ruleContent 正文（原版 checkBook）；
// 3) 检测结果写入书源分组（bookSourceGroup）：失败加标记（搜索失效/网站失效/校验超时/
//    js失效/搜索链接规则为空/搜索目录失效/搜索正文失效），成功清除全部失效标记；
// 4) "删除失效源"按含"失效"/"校验超时"的分组筛选（legado getInvalidGroupNames）。
import { httpGet, mergeUserAgent, updateBookSource, type BookSource } from "./api";
import { parseBookSourceJson, parseHtml, resolveSearchUrl, extractBookList, extractList, extractSingle, hostOf, resolveUrl, type BookSource as Src } from "./bookSourceEngine";

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
 * 取第一本书 → 提取 ruleToc 目录 → 若启用了正文检测，取第一章提取 ruleContent 正文。
 * 返回失败标记数组（原版文案："搜索目录失效" / "搜索正文失效"）。
 */
async function checkTocAndContent(src: Src, bookUrl: string, checks: VerifyChecks): Promise<string[]> {
  const marks: string[] = [];
  const base = src.bookSourceUrl || bookUrl;
  const resolvedBookUrl = bookUrl.startsWith("http") ? bookUrl : resolveUrl(bookUrl, base);
  const cookieJarHost = hostOf(src.bookSourceUrl);
  const ua = mergeUserAgent(src.httpHeaders, src.httpUserAgent);
  const html = await httpGet(resolvedBookUrl, ua, 8000, undefined, undefined, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const rules = src.ruleToc ?? {};
  if (checks.toc && rules.chapterList) {
    const items = await extractList(doc, rules.chapterList, {
      name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
    }, { baseUrl: resolvedBookUrl, result: html, sourceKey: src.bookSourceUrl, source: src });
    const toc = items.filter((i) => i.url);
    if (toc.length === 0) {
      marks.push("搜索目录失效");
      return marks;
    }
    if (checks.content && src.ruleContent?.content) {
      const chUrl = toc[0].url.startsWith("http") ? toc[0].url : resolveUrl(toc[0].url, resolvedBookUrl);
      const chHtml = await httpGet(chUrl, ua, 8000, undefined, undefined, undefined, cookieJarHost);
      const chDoc = parseHtml(chHtml);
      const content = await extractSingle(chDoc, src.ruleContent.content, {
        baseUrl: chUrl, result: chHtml, sourceKey: src.bookSourceUrl, source: src,
      });
      if (!content || content.trim().length < 30) marks.push("搜索正文失效");
    }
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
    // 学习原版：搜索到书后继续校验目录/正文（仅当源配置了对应规则且检测项启用）
    const hasTocRule = !!(src.ruleToc?.chapterList) && (checks.toc || checks.content);
    if (hasTocRule && items[0]?.bookUrl) {
      const marks = await checkTocAndContent(src, items[0].bookUrl, checks);
      if (marks.length > 0) {
        return { id: bs.id, name: bs.name, ok: false, count: items.length, ms: Date.now() - t0, reason: marks.join("、"), groups: marks };
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

/** 并发批量验证，保持输入顺序返回；检测结果写入书源分组并持久化（legado 机制） */
export async function verifySources(sources: BookSource[], opts?: VerifyOptions): Promise<VerifyResult[]> {
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
      const r = await verifySource(bs, { keyword: opts?.keyword, checks: opts?.checks });
      results[i] = r;
      // 学习原版：检测结果持久化到书源分组（失败标记 / 清除失效标记）
      const updatedJson = updateSourceGroups(bs.json, r.groups.length > 0 ? r.groups : null);
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
