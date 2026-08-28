/**
 * 书架页纯逻辑：布局/排序持久化、排序比较器、分组与文本过滤、拼贴分组。
 * 自 LibraryPage.tsx 拆出（无 React 依赖，可独立单测）。
 */
import type { BookCardLayout, ShelfItem } from "../components/BookCard";
import type { ShelfGroup, ShelfMember } from "../services/api";

export const LAYOUT_KEY = "library.layout";
export const SORT_KEY = "library.sort";

// 对齐 legado sortBooks：0=阅读时间 1=更新时间 2=书名 3=最近活动 4=作者 5=手动排序
export const SORT_LABELS = ["阅读时间", "更新时间", "书名", "最近活动", "作者", "手动排序"];

export interface SortState { mode: number; desc: boolean }

export function loadLayout(): BookCardLayout {
  const v = localStorage.getItem(LAYOUT_KEY);
  return v === "list" ? "list" : "grid";
}

export function loadSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SortState;
      if (typeof p.mode === "number" && typeof p.desc === "boolean") return p;
    }
  } catch { /* ignore */ }
  return { mode: 0, desc: true };
}

export function cnCompare(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN");
}

// 对齐 legado sortBooks：0=阅读时间 1=更新时间 2=书名 3=最近活动 4=作者 5=手动排序
export function sortShelfItems(items: ShelfItem[], mode: number, desc: boolean): ShelfItem[] {
  const readTime = (it: ShelfItem) =>
    ((it.kind === "local" ? it.book.last_opened_at : it.sb.last_opened_at) ?? 0);
  const addedAt = (it: ShelfItem) => (it.kind === "local" ? it.book.added_at : it.sb.added_at);
  const titleOf = (it: ShelfItem) => (it.kind === "local" ? it.book.title : it.sb.title);
  const authorOf = (it: ShelfItem) => (it.kind === "source" ? (it.sb.author ?? "") : "");
  const manualOrder = (it: ShelfItem) =>
    (it.kind === "local" ? (it.book.sort_order ?? null) : (it.sb.sort_order ?? null)) ?? Number.MAX_SAFE_INTEGER;
  const cmp = (a: ShelfItem, b: ShelfItem): number => {
    switch (mode) {
      case 1: return addedAt(a) - addedAt(b);
      case 2: return cnCompare(titleOf(a), titleOf(b));
      case 3: return Math.max(readTime(a), addedAt(a)) - Math.max(readTime(b), addedAt(b));
      case 4: return cnCompare(authorOf(a), authorOf(b));
      case 5: return manualOrder(a) - manualOrder(b) || addedAt(a) - addedAt(b);
      default: return readTime(a) - readTime(b);
    }
  };
  // 直接反转比较器而非 reverse()，保持同键值项的原始顺序（排序稳定）
  if (mode === 5) return [...items].sort(cmp); // 手动排序忽略升降序
  return [...items].sort((a, b) => (desc ? cmp(b, a) : cmp(a, b)));
}

export function itemMember(item: ShelfItem): ShelfMember {
  return item.kind === "local"
    ? { item_kind: "local", item_id: item.book.id }
    : { item_kind: "source", item_id: item.sb.id };
}

export function memberKey(m: ShelfMember): string {
  return `${m.item_kind}:${m.item_id}`;
}

/** 分组过滤："all" 全部 / "default" 未分组 / "g:<id>" 指定分组 */
export function filterByGroup(
  items: ShelfItem[],
  activeGroup: string,
  groups: ShelfGroup[],
  groupMembers: Map<string, Set<number>>,
): ShelfItem[] {
  if (activeGroup === "all") return items;
  if (activeGroup === "default") {
    return items.filter((i) => {
      const m = itemMember(i);
      // 不在任何分组
      return !groups.some((g) => {
        const set = groupMembers.get(`${m.item_kind}:${g.id}`);
        return set?.has(m.item_id);
      });
    });
  }
  const gid = Number(activeGroup.slice(2));
  return items.filter((i) => {
    const m = itemMember(i);
    return groupMembers.get(`${m.item_kind}:${gid}`)?.has(m.item_id) ?? false;
  });
}

/** 书架内过滤：书名/作者/来源名包含关键字（不区分大小写） */
export function filterByText(items: ShelfItem[], text: string): ShelfItem[] {
  const filterText = text.trim().toLowerCase();
  if (!filterText) return items;
  return items.filter((i) => {
    const title = (i.kind === "local" ? i.book.title : i.sb.title).toLowerCase();
    if (title.includes(filterText)) return true;
    if (i.kind === "source") {
      if ((i.sb.author ?? "").toLowerCase().includes(filterText)) return true;
      if ((i.sb.source_name ?? "").toLowerCase().includes(filterText)) return true;
    }
    return false;
  });
}

/** 分组拼贴：取每组内有成员的书（调用方再取组内前 4 本封面） */
export function collageOf(
  groups: ShelfGroup[],
  groupMembers: Map<string, Set<number>>,
  items: ShelfItem[],
): Array<{ group: ShelfGroup; members: ShelfItem[] }> {
  return groups
    .map((g) => {
      const local = groupMembers.get(`local:${g.id}`) ?? new Set<number>();
      const source = groupMembers.get(`source:${g.id}`) ?? new Set<number>();
      const members = items.filter((i) =>
        i.kind === "local" ? local.has(i.book.id) : source.has(i.sb.id)
      );
      return { group: g, members };
    })
    .filter((x) => x.members.length > 0);
}
