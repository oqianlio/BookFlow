import { addBookSource, httpGet, listBookSources, updateBookSource } from "./api";
import { parseBookSourceCollection } from "./bookSourceImport";
import type { SubscriptionRow } from "./api";

export interface SyncResult { added: number; updated: number; removed: number; failed: number }

export async function syncSubscription(sub: SubscriptionRow): Promise<SyncResult> {
  const text = await httpGet(sub.url, undefined, 20000);
  const remote = parseBookSourceCollection(text);
  const local = await listBookSources();
  const localByUrl = new Map(local.map((s) => [s.url, s]));
  // 远端源并行处理（无相互依赖）
  const results = await Promise.allSettled(remote.map(async (rs) => {
    const existing = localByUrl.get(rs.bookSourceUrl);
    if (existing) {
      const nextJson = JSON.stringify(rs);
      if (existing.json !== nextJson) {
        await updateBookSource(existing.id, rs.bookSourceName, rs.bookSourceUrl, nextJson);
        return "updated" as const;
      }
      return "unchanged" as const;
    }
    await addBookSource(rs.bookSourceName, rs.bookSourceUrl, JSON.stringify(rs));
    return "added" as const;
  }));
  let added = 0;
  let updated = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") {
      failed++;
      continue;
    }
    if (r.value === "added") added++;
    else if (r.value === "updated") updated++;
  }
  // removed 保持 0：本地书源可能是用户手动添加或来自其它订阅，无法安全判定删除
  return { added, updated, removed: 0, failed };
}
