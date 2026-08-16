// 数据备份与恢复：书源 + 书架在线书 + 阅读进度 + 阅读/主题设置
// v1：本地 JSON 文件（导出/导入），不做 WebDAV。
import {
  listBookSources, addBookSource, updateBookSource, getSourceByUrl,
  listShelfSourceBooks, addShelfSourceBook, getBookSourceProgress, saveBookSourceProgress,
  getSetting, setSetting,
  type ShelfSourceBook,
} from "./api";
import { loadReadingSettings, saveReadingSettings } from "./readingSettings";
import { getTheme } from "../components/theme";

export const BACKUP_VERSION = 1;

export interface BackupData {
  version: number;
  exportedAt: number;
  bookSources: Array<{ name: string; url: string; json: string; enabled: boolean }>;
  shelfSourceBooks: ShelfSourceBook[];
  sourceProgress: Array<{
    sourceId: number; bookUrl: string; title: string;
    chapterIndex: number; chapterUrl: string; chapterName: string;
  }>;
  settings: Record<string, string>;
  readingSettings: ReturnType<typeof loadReadingSettings> extends Promise<infer T> ? T : never;
  theme: { scheme: string; mode: string };
}

async function collectSettings(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    try { const v = await getSetting(k); if (v != null) out[k] = v; } catch { /* 单项失败跳过 */ }
  }
  return out;
}

/** 导出全量备份数据（不写盘，由调用方保存文件） */
export async function exportBackupData(): Promise<BackupData> {
  const [sources, shelfBooks, readingSettings, theme] = await Promise.all([
    listBookSources(),
    listShelfSourceBooks(),
    loadReadingSettings(),
    Promise.resolve(getTheme()),
  ]);
  const progress = [];
  for (const b of shelfBooks) {
    try {
      const p = await getBookSourceProgress(b.source_id, b.book_url);
      if (p) progress.push({
        sourceId: b.source_id, bookUrl: b.book_url, title: b.title,
        chapterIndex: p.chapter_index, chapterUrl: p.chapter_url, chapterName: p.chapter_name,
      });
    } catch { /* 单本进度失败跳过 */ }
  }
  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    bookSources: sources.map((s) => ({ name: s.name, url: s.url, json: s.json, enabled: s.enabled })),
    shelfSourceBooks: shelfBooks,
    sourceProgress: progress,
    settings: await collectSettings(["eyeCare", "reader.manualMode", "ttsRate"]),
    readingSettings,
    theme: { scheme: theme.scheme, mode: theme.mode },
  };
}

function parseBackup(text: string): BackupData {
  const d = JSON.parse(text) as BackupData;
  if (!d || typeof d !== "object" || !Array.isArray(d.bookSources)) {
    throw new Error("备份文件格式不正确");
  }
  if (d.version !== BACKUP_VERSION) {
    throw new Error(`备份版本不兼容（文件 v${d.version}，当前 v${BACKUP_VERSION}）`);
  }
  return d;
}

/** 导入备份：书源（按 url 匹配更新/新增）、书架、进度、设置。返回统计摘要 */
export async function importBackupData(text: string): Promise<{ sources: number; shelf: number; progress: number }> {
  const d = parseBackup(text);
  // 1. 书源：按 url 匹配（存在则更新 json/enabled，不存在则新增）
  let sources = 0;
  for (const s of d.bookSources) {
    try {
      const existing = await getSourceByUrl(s.url);
      if (existing) {
        await updateBookSource(existing.id, existing.name, s.url, s.json);
        sources++;
      } else {
        await addBookSource(s.name, s.url, s.json);
        sources++;
      }
    } catch { /* 单个书源失败跳过 */ }
  }
  // 2. 书架在线书 + 进度
  let shelf = 0;
  let progress = 0;
  for (const b of d.shelfSourceBooks) {
    try {
      await addShelfSourceBook({ sourceId: b.source_id, bookUrl: b.book_url, title: b.title, author: b.author ?? "", coverUrl: b.cover_url ?? "" });
      shelf++;
    } catch { /* 去重失败跳过 */ }
    const p = d.sourceProgress.find((x) => x.bookUrl === b.book_url && x.sourceId === b.source_id);
    if (p) {
      try {
        await saveBookSourceProgress({
          sourceId: p.sourceId, bookUrl: p.bookUrl, title: p.title,
          chapterIndex: p.chapterIndex, chapterUrl: p.chapterUrl, chapterName: p.chapterName, percent: 0,
        });
        progress++;
      } catch { /* 单本进度失败跳过 */ }
    }
  }
  // 3. 设置（后端键 + 前端 localStorage）
  for (const [k, v] of Object.entries(d.settings)) {
    try { await setSetting(k, v); } catch { /* 跳过 */ }
  }
  try { await saveReadingSettings(d.readingSettings); } catch { /* 跳过 */ }
  try {
    const { setTheme, SCHEMES, getTheme } = await import("../components/theme");
    const cur = getTheme();
    const scheme = (SCHEMES as string[]).includes(d.theme.scheme) ? d.theme.scheme as typeof cur.scheme : cur.scheme;
    const mode = d.theme.mode === "dark" || d.theme.mode === "light" ? d.theme.mode as typeof cur.mode : cur.mode;
    await setTheme({ scheme, mode });
  } catch { /* 主题恢复失败不影响 */ }
  return { sources, shelf, progress };
}
