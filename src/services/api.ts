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

export async function httpGet(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string> {
  return invoke<string>("http_get", { url, headers: headers ?? null, timeoutMs: timeoutMs ?? null });
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

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting_cmd", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  await invoke("set_setting_cmd", { key, value });
}
