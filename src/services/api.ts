import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  title: string;
  format: string;
  path: string;
  cover_path: string | null;
  added_at: number;
  last_opened_at: number | null;
  sort_order?: number | null;
}

export function coverUrl(path: string | null): string | undefined {
  return path ? convertFileSrc(path) : undefined;
}

export async function listBooks(): Promise<Book[]> {
  return invoke<Book[]>("list_books_cmd");
}

export async function importFiles(): Promise<Book[]> {
  const picked = await open({
    multiple: true,
    filters: [
      { name: "书籍", extensions: ["epub", "pdf", "md", "markdown", "txt"] },
    ],
  });
  if (!picked) return [];
  const files = Array.isArray(picked) ? picked : [picked];
  if (files.length === 0) return [];
  return invoke<Book[]>("import_books", { files });
}

export async function removeBook(id: number): Promise<void> {
  await invoke("remove_book", { id });
}

export async function readFileContent(path: string): Promise<string> {
  return invoke<string>("read_file_content", { path });
}

export async function saveProgress(bookId: number, location: string, percent: number): Promise<void> {
  await invoke("save_progress_cmd", { bookId, location, percent });
}

export async function getProgress(bookId: number): Promise<[string, number] | null> {
  return invoke<[string, number] | null>("get_progress_cmd", { bookId });
}

export async function listAnnotations(bookId: number) {
  return invoke<Array<{ id: number; book_id: number; format: string; location: string; text: string; note: string | null; color: string; created_at: number }>>("list_annotations_cmd", { bookId });
}

export async function addAnnotation(a: { bookId: number; format: string; location: string; text: string; note?: string; color: string }) {
  return invoke<number>("add_annotation_cmd", {
    bookId: a.bookId, format: a.format, location: a.location, text: a.text,
    note: a.note ?? null, color: a.color,
  });
}

export async function deleteAnnotation(id: number) {
  await invoke("delete_annotation_cmd", { id });
}

export async function listBookmarks(bookId: number) {
  return invoke<Array<{ id: number; book_id: number; location: string; label: string; created_at: number }>>("list_bookmarks_cmd", { bookId });
}

export async function addBookmark(b: { bookId: number; location: string; label: string }) {
  return invoke<number>("add_bookmark_cmd", { bookId: b.bookId, location: b.location, label: b.label });
}

export async function deleteBookmark(id: number) {
  await invoke("delete_bookmark_cmd", { id });
}

export interface BookSource {
  id: number; name: string; url: string; json: string;
  enabled: boolean; last_used_at: number | null;
}

export async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number,
  method?: string,
  body?: string,
  contentType?: string,
  cookieJar?: string,
): Promise<string> {
  // 空 URL 直接拒绝（书源规则提取失败时调用方应回退），避免无效请求
  if (!url.trim()) {
    console.error("[httpGet] 拒绝空 URL 请求（书源规则提取为空）");
    throw new Error("请求地址为空（书源规则提取失败）");
  }
  const t0 = performance.now();
  const short = url.length > 100 ? url.slice(0, 100) + "…" : url;
  try {
    const r = await invoke<string>("http_get", {
      url, headers: headers ?? null, timeoutMs: timeoutMs ?? null,
      method: method ?? null, body: body ?? null, contentType: contentType ?? null,
      cookieJar: cookieJar ?? null,
    });
    const ms = Math.round(performance.now() - t0);
    // 慢请求（>3s）记 warning，正常请求 Rust 侧已有日志，前端不重复
    if (ms > 3000) console.warn(`[httpGet] 慢请求 ${ms}ms ${method ?? "GET"} ${short}`);
    return r;
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    console.error(`[httpGet] 失败 ${ms}ms ${method ?? "GET"} ${short}: ${String(e)}`);
    throw e;
  }
}

export async function openLoginWindow(url: string, cookieJar: string): Promise<void> {
  await invoke("open_login_window", { url, cookieJar });
}

export function logFrontend(level: string, message: string): Promise<void> {
  return invoke("log_frontend", { level, message });
}

/** 读取开发者日志（最近 limit 行） */
export function readLogs(limit: number): Promise<string[]> {
  return invoke("read_logs", { limit });
}

/** 清空开发者日志 */
export function clearLogs(): Promise<void> {
  return invoke("clear_logs");
}

/** 日志文件大小（字节） */
export function logFileSize(): Promise<number> {
  return invoke("log_file_size");
}

/** 一键导出诊断信息（版本/DB/书源/缓存/最近日志），返回文本块 */
export function exportDiagnostics(): Promise<string> {
  return invoke("export_diagnostics");
}

export function mergeUserAgent(headers: Record<string, string> | undefined, userAgent: string | undefined): Record<string, string> | undefined {
  if (!userAgent) return headers;
  const hasUa = Object.keys(headers ?? {}).some((k) => k.toLowerCase() === "user-agent");
  if (hasUa) return headers;
  return { ...(headers ?? {}), "User-Agent": userAgent };
}

// 书源列表会话内短缓存：章节/目录/搜索/换源面板等高频调用避免重复 IPC 查库。
// 书源增删改/启停后立即失效；TTL 10s 兜底（外部修改不会长期陈旧）。
let sourcesCache: { at: number; data: BookSource[] } | null = null;
const SOURCES_TTL_MS = 10_000;

export async function listBookSources(): Promise<BookSource[]> {
  if (sourcesCache && Date.now() - sourcesCache.at < SOURCES_TTL_MS) return sourcesCache.data;
  const data = await invoke<BookSource[]>("list_book_sources");
  sourcesCache = { at: Date.now(), data };
  return data;
}

export function invalidateBookSourcesCache(): void {
  sourcesCache = null;
}
export async function addBookSource(name: string, url: string, json: string): Promise<number> {
  const id = await invoke<number>("add_book_source", { name, url, json });
  invalidateBookSourcesCache();
  return id;
}
export async function updateBookSource(id: number, name: string, url: string, json: string): Promise<void> {
  await invoke("update_book_source", { id, name, url, json });
  invalidateBookSourcesCache();
}
export async function deleteBookSource(id: number): Promise<void> {
  await invoke("delete_book_source", { id });
  invalidateBookSourcesCache();
}
export async function setBookSourceEnabled(id: number, enabled: boolean): Promise<void> {
  await invoke("set_book_source_enabled", { id, enabled });
  invalidateBookSourcesCache();
}

export interface SourceProgress {
  source_id: number; book_url: string; title: string; chapter_index: number;
  chapter_url: string; chapter_name: string; percent: number; updated_at: number;
}
export async function getBookSourceProgress(sourceId: number, bookUrl: string): Promise<SourceProgress | null> {
  return invoke<SourceProgress | null>("get_book_source_progress", { sourceId, bookUrl });
}
export async function saveBookSourceProgress(p: { sourceId: number; bookUrl: string; title: string; chapterIndex: number; chapterUrl: string; chapterName: string; percent: number }): Promise<void> {
  await invoke("save_book_source_progress", {
    sourceId: p.sourceId, bookUrl: p.bookUrl, title: p.title,
    chapterIndex: p.chapterIndex, chapterUrl: p.chapterUrl, chapterName: p.chapterName, percent: p.percent,
  });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting_cmd", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  await invoke("set_setting_cmd", { key, value });
}

export interface ShelfSourceBook {
  id: number; source_id: number; source_name: string; book_url: string;
  title: string; author: string | null; cover_url: string | null;
  added_at: number; last_opened_at: number | null;
  sort_order?: number | null;
  total_chapters?: number | null;
  has_update?: boolean;
  kind?: string | null;
}

export async function addShelfSourceBook(a: { sourceId: number; bookUrl: string; title: string; author?: string; coverUrl?: string }): Promise<number> {
  return invoke<number>("add_shelf_source_book", {
    sourceId: a.sourceId, bookUrl: a.bookUrl, title: a.title,
    author: a.author ?? null, coverUrl: a.coverUrl ?? null,
  });
}
export async function listShelfSourceBooks(): Promise<ShelfSourceBook[]> {
  return invoke<ShelfSourceBook[]>("list_shelf_source_books");
}
export async function removeShelfSourceBook(id: number): Promise<void> {
  await invoke("remove_shelf_source_book", { id });
}

export async function saveCachedChapter(c: { sourceId: number; bookUrl: string; chapterIndex: number; chapterUrl: string; chapterName: string; content: string }): Promise<void> {
  await invoke("save_cached_chapter", {
    input: {
      sourceId: c.sourceId, bookUrl: c.bookUrl, chapterIndex: c.chapterIndex,
      chapterUrl: c.chapterUrl, chapterName: c.chapterName, content: c.content,
    },
  });
}
export async function listCachedChapters(sourceId: number, bookUrl: string): Promise<Array<{ chapter_index: number; chapter_url: string; chapter_name: string; updated_at: number }>> {
  return invoke("list_cached_chapters", { sourceId, bookUrl });
}
export async function getCachedChapter(sourceId: number, bookUrl: string, chapterUrl: string): Promise<string | null> {
  return invoke<string | null>("get_cached_chapter", { sourceId, bookUrl, chapterUrl });
}
export async function deleteBookCache(sourceId: number, bookUrl: string): Promise<void> {
  await invoke("delete_book_cache", { sourceId, bookUrl });
}

export interface CacheSummary { book_count: number; chapter_count: number; total_bytes: number }
export interface CachedBook {
  source_id: number; book_url: string; title: string;
  chapter_count: number; bytes: number; updated_at: number;
}
export async function cacheSummary(): Promise<CacheSummary> {
  return invoke<CacheSummary>("cache_summary");
}
export async function listCachedBooks(): Promise<CachedBook[]> {
  return invoke<CachedBook[]>("list_cached_books");
}
export async function clearAllCache(): Promise<void> {
  await invoke("clear_all_cache");
}

export interface ReadingStats {
  source_id: number; book_url: string; title: string;
  read_seconds: number; read_count: number; last_read_at: number | null;
}

export async function recordRead(a: { sourceId: number; bookUrl: string; title: string; seconds: number; incrementCount: boolean }): Promise<void> {
  await invoke("record_read", {
    sourceId: a.sourceId, bookUrl: a.bookUrl, title: a.title,
    seconds: a.seconds, incrementCount: a.incrementCount,
  });
}
export async function getReadingStats(sourceId: number, bookUrl: string): Promise<ReadingStats | null> {
  return invoke<ReadingStats | null>("get_reading_stats", { sourceId, bookUrl });
}

export interface ReadingSummary {
  total_books: number;
  total_seconds: number;
  today_seconds: number;
  top_books: ReadingStats[];
  recent_reads: ReadingStats[];
}
export async function getReadingSummary(limit?: number): Promise<ReadingSummary> {
  return invoke<ReadingSummary>("get_reading_summary", { limit: limit ?? 10 });
}

export interface RssFeedPreview {
  title: string; site_url: string | null;
  articles: Array<{ guid: string; title: string; link: string | null; content: string | null; published_at: number | null }>;
}
export interface RssFeedRow { id: number; title: string; url: string; site_url: string | null; added_at: number }
export interface RssArticleRow {
  id: number; feed_id: number; guid: string; title: string; link: string | null;
  content: string | null; published_at: number | null; fetched_at: number;
  is_read: boolean;
}

export async function fetchRssFeed(url: string): Promise<RssFeedPreview> {
  return invoke<RssFeedPreview>("fetch_rss_feed", { url });
}
export async function addRssFeed(url: string): Promise<number> {
  return invoke<number>("add_rss_feed", { url });
}
export async function refreshRssFeed(feedId: number): Promise<number> {
  return invoke<number>("refresh_rss_feed", { feedId });
}
export async function listRssFeeds(): Promise<RssFeedRow[]> {
  return invoke<RssFeedRow[]>("list_rss_feeds");
}
export async function deleteRssFeed(id: number): Promise<void> {
  await invoke("delete_rss_feed", { id });
}
export async function listRssArticles(feedId: number): Promise<RssArticleRow[]> {
  return invoke<RssArticleRow[]>("list_rss_articles", { feedId });
}
export async function getRssArticle(id: number): Promise<RssArticleRow | null> {
  return invoke<RssArticleRow | null>("get_rss_article", { id });
}
export async function markRssArticleRead(id: number, read: boolean): Promise<void> {
  await invoke("mark_rss_article_read", { id, read });
}
export async function markRssFeedRead(feedId: number): Promise<void> {
  await invoke("mark_rss_feed_read", { feedId });
}
export async function rssUnreadCount(feedId: number): Promise<number> {
  return invoke<number>("rss_unread_count", { feedId });
}
export async function exportRssOpml(): Promise<string> {
  return invoke<string>("export_rss_opml");
}
export async function importRssOpml(opml: string): Promise<number> {
  return invoke<number>("import_rss_opml", { opml });
}

export interface SubscriptionRow { id: number; name: string; url: string; last_checked_at: number | null }

export async function addSubscription(url: string): Promise<number> {
  return invoke<number>("add_subscription", { url });
}
export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  return invoke<SubscriptionRow[]>("list_subscriptions");
}
export async function deleteSubscription(id: number): Promise<void> {
  await invoke("delete_subscription", { id });
}
export async function setSubscriptionChecked(id: number): Promise<void> {
  await invoke("set_subscription_checked", { id });
}
export async function getSourceByUrl(url: string): Promise<BookSource | null> {
  return invoke<BookSource | null>("get_source_by_url", { url });
}
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

export interface FontFileRow { name: string; file: string }

export async function copyFontFile(src: string): Promise<FontFileRow> {
  return invoke<FontFileRow>("copy_font_file", { src });
}
export async function listFontFiles(): Promise<FontFileRow[]> {
  return invoke<FontFileRow[]>("list_font_files");
}

// ============ 书架分组 / 书单 ============

export interface ShelfGroup {
  id: number; name: string; member_count: number; created_at: number;
}
export interface ShelfMember { item_kind: "local" | "source"; item_id: number }

export async function listShelfGroups(): Promise<ShelfGroup[]> {
  return invoke<ShelfGroup[]>("list_shelf_groups");
}
export async function createShelfGroup(name: string): Promise<number> {
  return invoke<number>("create_shelf_group", { name });
}
export async function renameShelfGroup(id: number, name: string): Promise<void> {
  await invoke("rename_shelf_group", { id, name });
}
export async function deleteShelfGroup(id: number): Promise<void> {
  await invoke("delete_shelf_group", { id });
}
export async function setShelfGroupMembers(groupId: number, members: ShelfMember[]): Promise<void> {
  await invoke("set_shelf_group_members", { groupId, members });
}
export async function addShelfGroupMembers(groupId: number, members: ShelfMember[]): Promise<void> {
  await invoke("add_shelf_group_members", { groupId, members });
}
export async function removeShelfGroupMembers(groupId: number, members: ShelfMember[]): Promise<void> {
  await invoke("remove_shelf_group_members", { groupId, members });
}
export async function listShelfGroupMembers(groupId: number): Promise<ShelfMember[]> {
  return invoke<ShelfMember[]>("list_shelf_group_members", { groupId });
}
/** 批量移除书架条目（混合 local/source）；返回被删的本地书 id */
export async function removeShelfItems(items: ShelfMember[]): Promise<number[]> {
  return invoke<number[]>("remove_shelf_items", { items });
}
/** 手动排序：按传入顺序持久化 sort_order */
export async function reorderShelfItems(items: ShelfMember[]): Promise<void> {
  await invoke("reorder_shelf_items", { items });
}
/** 记录目录检查结果（NEW 红点 + 分类标签）；totalChapters/kind 传 null 保留原值 */
export async function setShelfSourceTocInfo(id: number, totalChapters: number | null, hasUpdate: boolean, kind?: string | null): Promise<void> {
  await invoke("set_shelf_source_toc_info", { id, totalChapters, hasUpdate, kind: kind ?? null });
}

export interface BookList {
  id: number; name: string; description: string | null; item_count: number; created_at: number;
}
export interface BookListItem { item_kind: "local" | "source"; item_id: number; added_at: number }

export async function listBookLists(): Promise<BookList[]> {
  return invoke<BookList[]>("list_book_lists");
}
export async function createBookList(name: string, description?: string): Promise<number> {
  return invoke<number>("create_book_list", { name, description: description ?? null });
}
export async function deleteBookList(id: number): Promise<void> {
  await invoke("delete_book_list", { id });
}
export async function addBookListItem(listId: number, itemKind: "local" | "source", itemId: number): Promise<void> {
  await invoke("add_book_list_item", { listId, itemKind, itemId });
}
export async function removeBookListItem(listId: number, itemKind: "local" | "source", itemId: number): Promise<void> {
  await invoke("remove_book_list_item", { listId, itemKind, itemId });
}
export async function listBookListItems(listId: number): Promise<BookListItem[]> {
  return invoke<BookListItem[]>("list_book_list_items", { listId });
}
