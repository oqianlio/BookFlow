// 数据备份与恢复：书源 + 书架在线书 + 阅读进度 + 阅读/主题设置
// v1：本地 JSON 文件（导出/导入），不做 WebDAV。
import {
  listBookSources, addBookSource, updateBookSource, getSourceByUrl,
  listShelfSourceBooks, addShelfSourceBook, getBookSourceProgress, saveBookSourceProgress,
  setShelfSourceTocInfo,
  getSetting, setSetting,
  getAppDataDir, writeTextFile, cleanOldBackups,
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

/** 导入备份：书源（按 url 匹配更新/新增）、书架、进度、设置。返回统计摘要（含各项失败数） */
export async function importBackupData(text: string): Promise<{
  sources: number; shelf: number; progress: number;
  failed: { sources: number; shelf: number; progress: number; settings: number };
}> {
  const d = parseBackup(text);
  const failed = { sources: 0, shelf: 0, progress: 0, settings: 0 };
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
    } catch { failed.sources++; /* 单个书源失败跳过，计入汇总 */ }
  }
  // 2. 书架在线书 + 进度 + 目录信息（章节数/更新标记/分类）
  let shelf = 0;
  let progress = 0;
  for (const b of d.shelfSourceBooks) {
    let newId: number | null = null;
    try {
      newId = await addShelfSourceBook({ sourceId: b.source_id, bookUrl: b.book_url, title: b.title, author: b.author ?? "", coverUrl: b.cover_url ?? "" });
      shelf++;
    } catch { failed.shelf++; /* 去重/写入失败跳过，计入汇总 */ }
    if (newId != null && (b.total_chapters != null || b.kind || b.intro)) {
      await setShelfSourceTocInfo(newId, b.total_chapters ?? null, !!b.has_update, b.kind ?? undefined, b.intro ?? undefined).catch(() => { failed.shelf++; /* 目录信息失败计入汇总 */ });
    }
    const p = d.sourceProgress.find((x) => x.bookUrl === b.book_url && x.sourceId === b.source_id);
    if (p) {
      try {
        await saveBookSourceProgress({
          sourceId: p.sourceId, bookUrl: p.bookUrl, title: p.title,
          chapterIndex: p.chapterIndex, chapterUrl: p.chapterUrl, chapterName: p.chapterName, percent: 0,
        });
        progress++;
      } catch { failed.progress++; /* 单本进度失败跳过，计入汇总 */ }
    }
  }
  // 3. 设置（后端键 + 前端 localStorage）
  for (const [k, v] of Object.entries(d.settings)) {
    try { await setSetting(k, v); } catch { failed.settings++; }
  }
  try { await saveReadingSettings(d.readingSettings); } catch { failed.settings++; }
  try {
    const { setTheme, SCHEMES, getTheme } = await import("../components/theme");
    const cur = getTheme();
    const scheme = (SCHEMES as string[]).includes(d.theme.scheme) ? d.theme.scheme as typeof cur.scheme : cur.scheme;
    const mode = d.theme.mode === "dark" || d.theme.mode === "light" ? d.theme.mode as typeof cur.mode : cur.mode;
    await setTheme({ scheme, mode });
  } catch { /* 主题恢复失败不影响 */ }
  return { sources, shelf, progress, failed };
}

// ==== 自动备份 ====
const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24h
const AUTO_BACKUP_KEEP = 5; // 最多保留 5 份

/** 应用启动时自动备份：超过 24h 未备份时执行，保留最近 5 份 */
export async function autoBackupIfDue(): Promise<{ done: boolean; file?: string; error?: string }> {
  try {
    const enabled = await getSetting("backup.autoEnabled");
    if (enabled !== "1") return { done: false };

    const lastStr = await getSetting("backup.lastAutoAt");
    const last = Number(lastStr ?? "0");
    if (Date.now() - last < AUTO_BACKUP_INTERVAL) return { done: false };

    const data = await exportBackupData();
    const date = new Date().toISOString().slice(0, 10);
    const dir = await getAppDataDir();
    const file = `${dir}\\backups\\auto-${date}.json`;
    await writeTextFile(file, JSON.stringify(data));
    await setSetting("backup.lastAutoAt", String(Date.now()));
    // 清理旧备份（保留最近 5 份）
    await cleanOldBackups(AUTO_BACKUP_KEEP).catch(() => {});
    return { done: true, file };
  } catch (e) {
    return { done: false, error: String(e).slice(0, 80) };
  }
}
