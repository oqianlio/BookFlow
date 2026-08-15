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
  return invoke<string>("http_get", {
    url, headers: headers ?? null, timeoutMs: timeoutMs ?? null,
    method: method ?? null, body: body ?? null, contentType: contentType ?? null,
    cookieJar: cookieJar ?? null,
  });
}

export async function openLoginWindow(url: string, cookieJar: string): Promise<void> {
  await invoke("open_login_window", { url, cookieJar });
}

export function logFrontend(level: string, message: string): Promise<void> {
  return invoke("log_frontend", { level, message });
}

export function mergeUserAgent(headers: Record<string, string> | undefined, userAgent: string | undefined): Record<string, string> | undefined {
  if (!userAgent) return headers;
  const hasUa = Object.keys(headers ?? {}).some((k) => k.toLowerCase() === "user-agent");
  if (hasUa) return headers;
  return { ...(headers ?? {}), "User-Agent": userAgent };
}

export async function listBookSources(): Promise<BookSource[]> {
  return invoke<BookSource[]>("list_book_sources");
}
export async function addBookSource(name: string, url: string, json: string): Promise<number> {
  return invoke<number>("add_book_source", { name, url, json });
}
export async function updateBookSource(id: number, name: string, url: string, json: string): Promise<void> {
  await invoke("update_book_source", { id, name, url, json });
}
export async function deleteBookSource(id: number): Promise<void> {
  await invoke("delete_book_source", { id });
}
export async function setBookSourceEnabled(id: number, enabled: boolean): Promise<void> {
  await invoke("set_book_source_enabled", { id, enabled });
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

export interface RssFeedPreview {
  title: string; site_url: string | null;
  articles: Array<{ guid: string; title: string; link: string | null; content: string | null; published_at: number | null }>;
}
export interface RssFeedRow { id: number; title: string; url: string; site_url: string | null; added_at: number }
export interface RssArticleRow {
  id: number; feed_id: number; guid: string; title: string; link: string | null;
  content: string | null; published_at: number | null; fetched_at: number;
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
