import type { SearchHit } from "../services/searchService";

/**
 * 页面导航会话缓存：详情页/阅读页会把浏览页卸载，返回时重新挂载会导致
 * 内部 state（选中的分类、搜索结果等）丢失，用户必须重新选择。
 * 这里用模块级缓存保存浏览页的浏览现场，返回时恢复。
 */

export interface ExploreSnapshot {
  active: { title: string; url: string } | null;
  books: SearchHit[];
  page: number;
}

export interface DiscoverSnapshot {
  query: string;
  hits: SearchHit[];
}

const exploreSnapshots = new Map<number, ExploreSnapshot>();
let discoverSnapshot: DiscoverSnapshot | null = null;

export function saveExploreSnapshot(sourceId: number, snap: ExploreSnapshot): void {
  exploreSnapshots.set(sourceId, snap);
}

export function takeExploreSnapshot(sourceId: number): ExploreSnapshot | undefined {
  return exploreSnapshots.get(sourceId);
}

export function saveDiscoverSnapshot(snap: DiscoverSnapshot): void {
  discoverSnapshot = snap;
}

export function takeDiscoverSnapshot(): DiscoverSnapshot | null {
  return discoverSnapshot;
}

export function resetNavCache(): void {
  exploreSnapshots.clear();
  discoverSnapshot = null;
}

/** 返回可恢复的快照；快照的分类已不在书源当前分类列表中时视为失效（规则可能已变） */
export function restoreExploreSnapshot(
  snap: ExploreSnapshot | undefined,
  cats: Array<{ title: string; url: string }>,
): ExploreSnapshot | null {
  if (!snap) return null;
  if (snap.active && !cats.some((c) => c.url === snap.active!.url)) return null;
  return snap;
}
