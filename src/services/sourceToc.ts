import { listBookSources, httpGet, mergeUserAgent } from "./api";
import { parseBookSourceJson, parseHtml, extractSingle, extractList, hostOf, jsonGet, type BookSource, type ExtractContext } from "./bookSourceEngine";

export interface TocItem { name: string; url: string }
/** 书籍信息（对应 legado ruleBookInfo 解析结果） */
export interface SourceBookInfo {
  title: string;
  author: string;
  intro: string;
  coverUrl: string;
  /** 分类/类型，如 "科幻"（ruleBookInfo.kind） */
  kind?: string;
  /** 字数（ruleBookInfo.wordCount 原始文本，如 "123.45万字"） */
  wordCount?: string;
  /** 最新章节名（ruleBookInfo.lastChapter） */
  lastChapter?: string;
  /** 连载状态（ruleBookInfo.status，如 "连载中"/"已完结"） */
  status?: string;
  /** 更新时间（ruleBookInfo.updateTime 原始文本） */
  updateTime?: string;
}
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

/** legado init 规则（JSON 源初始路径，如 `$.data.bookInfo`）：取子对象作为后续规则的 result。
 *  非 JSON 或提取失败时原样返回。 */
export function applyInitResult(init: string | undefined, result: string): string {
  if (!init || !init.trim()) return result;
  try {
    const j = JSON.parse(result);
    const path = init.replace(/^\$\.?/, "").trim();
    if (!path) return result;
    const v = jsonGet(j, path);
    if (v != null) return JSON.stringify(v);
  } catch {
    // 非 JSON 响应（HTML 等）或路径无效：不应用 init
  }
  return result;
}

/**
 * init 规则统一处理（legado）：
 * - `@put:{...}` / `@get:...` 开头 → 走规则求值（副作用：变量落 sourceVars，result 不变）
 * - 其余（JSON 路径如 `$.data.bookInfo`）→ applyInitResult
 * 返回 string 或 Promise<string>：非 @put/@get 路径同步返回（保持原 applyInitResult 时序，
 * 避免额外 microtask 改变 ReaderPage 渲染时机——组件测试依赖该时序）。
 */
export function applyInitRule(doc: Document, init: string | undefined, html: string, ctx: ExtractContext): string | Promise<string> {
  const t = (init ?? "").trim();
  if (t.startsWith("@put:") || t.startsWith("@get:")) {
    return extractSingle(doc, t, { ...ctx, result: html }).then(() => html);
  }
  return applyInitResult(init, html);
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
  return fetchTocBySource(s, opts.bookUrl, opts.initialTitle);
}

/** 真实目录链路：给定已解析书源与书籍 URL，请求书籍页 → 应用 ruleBookInfo（提取 tocUrl）→
 *  请求目录页 → 按 ruleToc 提取章节（含 nextTocUrl 分页）。
 *  供 fetchToc（DB 书源）与健康检查（tmp_sources 书源）共用，保证检测链路与真实阅读一致。 */
export async function fetchTocBySource(s: BookSource, bookUrl: string, initialTitle: string): Promise<TocResult> {
  if (!bookUrl) throw new Error("书籍地址无效，无法打开");
  const base = s.bookSourceUrl || bookUrl;
  const resolvedBookUrl = bookUrl.startsWith("http") ? bookUrl : new URL(bookUrl, base).toString();
  const cookieJarHost = hostOf(s.bookSourceUrl);
  const html = await httpGet(resolvedBookUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  const doc = parseHtml(html);
  const bi = s.ruleBookInfo ?? {};
  // init：legado init 规则（JSON 路径取子对象；@put/@get 落变量）——后续规则相对处理后的 result 执行
  const initBi = applyInitRule(doc, bi.init, html, { sourceKey: s.bookSourceUrl, source: s, baseUrl: resolvedBookUrl });
  const biResult = typeof initBi === "string" ? initBi : await initBi;
  // legado js 上下文 book 对象（chapterUrl 等规则可能引用 book.bookUrl/tocUrl）
  const book = { bookUrl: resolvedBookUrl, name: initialTitle, tocUrl: "" };
  const title = bi.name ? await extractSingle(doc, bi.name, { result: biResult, sourceKey: s.bookSourceUrl, book }) : initialTitle;
  const author = bi.author ? await extractSingle(doc, bi.author, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const intro = bi.intro ? await extractSingle(doc, bi.intro, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const cover = bi.coverUrl ? await extractSingle(doc, bi.coverUrl, { baseUrl: resolvedBookUrl, result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  // 扩展信息字段（legado ruleBookInfo）：kind/wordCount/lastChapter/status/updateTime
  const kind = bi.kind ? await extractSingle(doc, bi.kind, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const wordCount = bi.wordCount ? await extractSingle(doc, bi.wordCount, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const lastChapter = bi.lastChapter ? await extractSingle(doc, bi.lastChapter, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const status = bi.status ? await extractSingle(doc, bi.status, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  const updateTime = bi.updateTime ? await extractSingle(doc, bi.updateTime, { result: biResult, sourceKey: s.bookSourceUrl, book }) : "";
  // tocUrl 规则可能提取为空（页面无该链接）：回退到书籍页本身，避免空 URL 请求
  const tocUrlRaw = (bi.tocUrl ? await extractSingle(doc, bi.tocUrl, { baseUrl: resolvedBookUrl, result: biResult, sourceKey: s.bookSourceUrl, book }) : "") || resolvedBookUrl;
  // 相对 tocUrl（JSON API 源常见，如 `/qbread/...`）相对 bookSourceUrl 解析为完整 URL
  const tocUrl = tocUrlRaw.startsWith("http") ? tocUrlRaw : new URL(tocUrlRaw, base).toString();
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
    // 每页响应独立应用 init（分页目录结构相同）
    const initPage = applyInitRule(curDoc, rules.init, curHtml, { sourceKey: s.bookSourceUrl, source: s, baseUrl: curUrl });
    const pageResult = typeof initPage === "string" ? initPage : await initPage;
    const items = await extractList(curDoc, rules.chapterList ?? "", {
      name: rules.chapterName ?? "", url: rules.chapterUrl ?? "",
    }, { baseUrl: curUrl, result: pageResult, sourceKey: s.bookSourceUrl, book: tocBook });
    for (const it of items) {
      if (!it.url) continue;
      const abs = it.url.startsWith("http") ? it.url : new URL(it.url, curUrl).toString();
      if (seenChapter.has(abs)) continue;
      seenChapter.add(abs);
      toc.push({ name: it.name || "未命名章节", url: abs });
    }
    if (!rules.nextTocUrl || page >= 49) break;
    const next = (await extractSingle(curDoc, rules.nextTocUrl, {
      baseUrl: curUrl, result: pageResult, sourceKey: s.bookSourceUrl, book: tocBook,
    }))?.trim();
    if (!next) break;
    const nextUrl = next.startsWith("http") ? next : new URL(next, curUrl).toString();
    if (seenPage.has(nextUrl)) break; // 防循环
    seenPage.add(nextUrl);
    curUrl = nextUrl;
    curHtml = await httpGet(nextUrl, mergeUserAgent(s.httpHeaders, s.httpUserAgent), undefined, undefined, undefined, undefined, cookieJarHost);
  }
  return {
    info: {
      title: title || initialTitle, author, intro, coverUrl: cover,
      kind, wordCount, lastChapter, status, updateTime,
    },
    toc,
    loginUrl: s.loginUrl,
  };
}
