import { addBookSource, httpGet, listBookSources, updateBookSource } from "./api";
import { parseBookSourceCollection } from "./bookSourceImport";
import type { SubscriptionRow } from "./api";

export interface SyncResult { added: number; updated: number; removed: number; failed: number }

export async function syncSubscription(sub: SubscriptionRow): Promise<SyncResult> {
  const text = await httpGet(sub.url, undefined, 20000);
  const remote = parseBookSourceCollection(text);
  const local = await listBookSources();
  const localByUrl = new Map(local.map((s) => [s.url, s]));
  let added = 0;
  let updated = 0;
  let failed = 0;
  for (const rs of remote) {
    try {
      const existing = localByUrl.get(rs.bookSourceUrl);
      if (existing) {
        const nextJson = JSON.stringify(rs);
        if (existing.json !== nextJson) {
          await updateBookSource(existing.id, rs.bookSourceName, rs.bookSourceUrl, nextJson);
          updated++;
        }
      } else {
        await addBookSource(rs.bookSourceName, rs.bookSourceUrl, JSON.stringify(rs));
        added++;
      }
    } catch {
      failed++;
    }
  }
  return { added, updated, removed: 0, failed };
}
