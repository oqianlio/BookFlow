import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BookCard, { formatLabel as formatLabelSafe, type BookCardLayout, type ShelfItem } from "../components/BookCard";
import ConfirmDialog from "../components/ConfirmDialog";
import GroupChips, { GroupManagerDialog, GroupPickerDialog } from "../components/GroupChips";
import BookListPickerDialog from "../components/BookListPicker";
import { BookIcon, GridIcon, ListIcon, SearchIcon, CompactIcon, SortIcon, RefreshIcon, FilterIcon } from "../components/icons";
import { searchBookSources } from "../services/searchService";
import type { SearchHit as OnlineHit } from "../services/searchService";
import { clearTocCache, fetchToc } from "../services/sourceToc";
import { downloadBook } from "../services/chapterCache";
import { parseBookSourceJson } from "../services/bookSourceEngine";
import {
  importFiles, listBooks, listShelfSourceBooks, listBookSources,
  listShelfGroups, createShelfGroup, renameShelfGroup, deleteShelfGroup,
  listShelfGroupMembers, addShelfGroupMembers, removeShelfGroupMembers,
  removeShelfItems, reorderShelfItems, setShelfSourceTocInfo, listBookLists, createBookList, deleteBookList,
  addBookListItem, removeBookListItem, listBookListItems, coverUrl, type Book, type ShelfSourceBook,
  type ShelfGroup, type ShelfMember,
} from "../services/api";
import { useError } from "../components/ErrorDialog";

const LAYOUT_KEY = "library.layout";
const SORT_KEY = "library.sort";

// 对齐 legado sortBooks：0=阅读时间 1=更新时间 2=书名 3=最近活动 4=作者 5=手动排序
const SORT_LABELS = ["阅读时间", "更新时间", "书名", "最近活动", "作者", "手动排序"];

interface SortState { mode: number; desc: boolean }

function loadLayout(): BookCardLayout {
  const v = localStorage.getItem(LAYOUT_KEY);
  return v === "list" ? "list" : "grid";
}

function loadSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SortState;
      if (typeof p.mode === "number" && typeof p.desc === "boolean") return p;
    }
  } catch { /* ignore */ }
  return { mode: 0, desc: true };
}

function cnCompare(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN");
}

function sortShelfItems(items: ShelfItem[], mode: number, desc: boolean): ShelfItem[] {
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

function itemMember(item: ShelfItem): ShelfMember {
  return item.kind === "local"
    ? { item_kind: "local", item_id: item.book.id }
    : { item_kind: "source", item_id: item.sb.id };
}

function memberKey(m: ShelfMember): string {
  return `${m.item_kind}:${m.item_id}`;
}

export default function LibraryPage({ onOpenBook, onOpenSourceBook, onOpenOnlineBook, onOpenInfo, initialSearch }: {
  onOpenBook: (b: Book, jumpTo?: string) => void;
  onOpenSourceBook?: (sb: ShelfSourceBook) => void;
  onOpenOnlineBook?: (h: OnlineHit) => void;
  onOpenInfo?: (hit: OnlineHit) => void;
  initialSearch?: string;
}) {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [groups, setGroups] = useState<ShelfGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<Map<string, Set<number>>>(new Map());
  const [activeGroup, setActiveGroup] = useState<string>("all"); // "all" | "default" | `g:${id}`
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [localHits, setLocalHits] = useState<Array<{ book_id: number; title: string; format: string; text: string; location: string }>>([]);
  const [onlineHits, setOnlineHits] = useState<OnlineHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchSeqRef = useRef(0);
  const [layout, setLayout] = useState<BookCardLayout>(loadLayout);
  const [sort, setSort] = useState<SortState>(loadSort);
  const [showSortMenu, setShowSortMenu] = useState(false);
  // legado gridStyle=1：标题叠加在封面底部（渐变遮罩）
  const [gridOverlay, setGridOverlay] = useState(() => localStorage.getItem("library.gridOverlay") === "1");
  const applyGridOverlay = (v: boolean) => {
    setGridOverlay(v);
    localStorage.setItem("library.gridOverlay", v ? "1" : "0");
  };
  // legado 文件夹模式：分组显示为封面拼贴卡片
  const [groupCollage, setGroupCollage] = useState(() => localStorage.getItem("library.groupCollage") === "1");
  const applyGroupCollage = (v: boolean) => {
    setGroupCollage(v);
    localStorage.setItem("library.groupCollage", v ? "1" : "0");
  };
  // legado shelf searchKey：书架内快速过滤（书名/作者/来源）
  const [showShelfFilter, setShowShelfFilter] = useState(false);
  const [shelfFilter, setShelfFilter] = useState("");
  // 多选模式
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 弹窗
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showBookListPicker, setShowBookListPicker] = useState(false);
  const [bookLists, setBookLists] = useState<Awaited<ReturnType<typeof listBookLists>>>([]);
  // 书单视图
  const [viewMode, setViewMode] = useState<"shelf" | "lists">("shelf");
  const [activeList, setActiveList] = useState<number | null>(null);
  const [listItems, setListItems] = useState<ShelfItem[]>([]);
  const { showError } = useError();

  const toggleLayout = () => {
    setLayout((prev) => {
      const next: BookCardLayout = prev === "grid" ? "list" : prev === "list" ? "compact" : "grid";
      localStorage.setItem(LAYOUT_KEY, next);
      return next;
    });
  };

  const applySort = (next: SortState) => {
    setSort(next);
    localStorage.setItem(SORT_KEY, JSON.stringify(next));
  };

  const sortLabel = `${sort.desc ? "↓" : "↑"} ${SORT_LABELS[sort.mode] ?? SORT_LABELS[0]}`;

  // legado 更新目录：清缓存后逐本刷新在线书目录，完成后重挂载卡片取新数据
  const [refreshingToc, setRefreshingToc] = useState(false);
  const [tocVersion, setTocVersion] = useState(0);
  const handleRefreshToc = () => {
    const sourceBooks = items.filter((i) => i.kind === "source");
    if (sourceBooks.length === 0) { showError("书架中没有在线书籍"); return; }
    if (refreshingToc) return;
    setRefreshingToc(true);
    clearTocCache();
    void (async () => {
      for (const it of sourceBooks) {
        if (it.kind !== "source") continue;
        try {
          const r = await fetchToc({ sourceId: it.sb.source_id, bookUrl: it.sb.book_url, initialTitle: it.sb.title });
          // legado hasUpdate：本次检查到的章节数多于上次记录 → NEW 标记；kind/intro 同步保存
          const prev = it.sb.total_chapters;
          const grew = prev != null && r.toc.length > prev;
          await setShelfSourceTocInfo(it.sb.id, r.toc.length, grew, r.info.kind || undefined, r.info.intro || undefined).catch(() => {});
        } catch { /* 单本失败继续 */ }
      }
      setRefreshingToc(false);
      await refresh().catch(() => {});
      setTocVersion((v) => v + 1);
    })();
  };

  const loadGroups = useCallback(async () => {
    try {
      const gs = await listShelfGroups();
      setGroups(gs);
      // 分组 → 成员 id 集合（local 与 source 分开存）
      const map = new Map<string, Set<number>>();
      for (const g of gs) {
        const members = await listShelfGroupMembers(g.id);
        map.set(`local:${g.id}`, new Set(members.filter((m) => m.item_kind === "local").map((m) => m.item_id)));
        map.set(`source:${g.id}`, new Set(members.filter((m) => m.item_kind === "source").map((m) => m.item_id)));
      }
      setGroupMembers(map);
    } catch (e) {
      showError(String(e));
    }
  }, [showError]);

  const refresh = useCallback(async () => {
    try {
      const [local, source] = await Promise.all([
        listBooks(),
        listShelfSourceBooks().catch(() => [] as ShelfSourceBook[]),
      ]);
      setItems([
        ...local.map((b) => ({ kind: "local" as const, book: b })),
        ...source.map((sb) => ({ kind: "source" as const, sb })),
      ]);
    } catch (e) {
      showError(String(e));
    } finally {
      setInitialLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
    void loadGroups();
  }, [refresh, loadGroups]);

  const loadBookLists = useCallback(async () => {
    try {
      setBookLists(await listBookLists());
    } catch (e) {
      showError(String(e));
    }
  }, [showError]);

  useEffect(() => { void loadBookLists(); }, [loadBookLists]);

  const loadListItems = useCallback(async (listId: number) => {
    try {
      const members = await listBookListItems(listId);
      const [local, source] = await Promise.all([listBooks(), listShelfSourceBooks().catch(() => [] as ShelfSourceBook[])]);
      const localMap = new Map(local.map((b) => [b.id, b]));
      const sourceMap = new Map(source.map((s) => [s.id, s]));
      const out: ShelfItem[] = [];
      for (const m of members) {
        if (m.item_kind === "local") {
          const b = localMap.get(m.item_id);
          if (b) out.push({ kind: "local", book: b });
        } else {
          const s = sourceMap.get(m.item_id);
          if (s) out.push({ kind: "source", sb: s });
        }
      }
      setListItems(out);
    } catch (e) {
      showError(String(e));
    }
  }, [showError]);

  useEffect(() => {
    if (viewMode === "lists" && activeList != null) void loadListItems(activeList);
  }, [viewMode, activeList, loadListItems]);

  const handleImport = async () => {
    setBusy(true);
    try {
      await importFiles();
      await refresh();
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const pendingRemoveRef = useRef<ShelfItem[] | null>(null);

  const handleRemove = (item: ShelfItem) => {
    const name = item.kind === "local" ? item.book.title : item.sb.title;
    pendingRemoveRef.current = [item];
    setConfirmMsg(`确定从书架移除「${name}」吗？`);
  };

  const handleBatchRemove = () => {
    if (selected.size === 0) return;
    const targets = items.filter((i) => selected.has(memberKey(itemMember(i))));
    pendingRemoveRef.current = targets;
    setConfirmMsg(`确定从书架移除选中的 ${targets.length} 本书吗？`);
  };

  const doRemove = async () => {
    const targets = pendingRemoveRef.current;
    setConfirmMsg(null);
    pendingRemoveRef.current = null;
    if (!targets || targets.length === 0) return;
    try {
      await removeShelfItems(targets.map(itemMember));
      await Promise.all([refresh(), loadGroups()]);
      setSelected(new Set());
      setSelecting(false);
    } catch (e) {
      showError(String(e));
    }
  };

  const handleOpen = (item: ShelfItem) => {
    if (item.kind === "local") onOpenBook(item.book);
    else onOpenSourceBook?.(item.sb);
  };

  // ==== 多选批量下载（legado 缓存选中书籍） ====
  const [showBatchDlConfirm, setShowBatchDlConfirm] = useState(false);
  const [batchDlLabel, setBatchDlLabel] = useState<string | null>(null);
  const batchDlSignalRef = useRef({ cancelled: false });

  const runBatchDownload = async () => {
    setShowBatchDlConfirm(false);
    const targets = items.filter((i) => i.kind === "source" && selected.has(memberKey(itemMember(i))));
    if (targets.length === 0) { showError("选中的书籍中没有在线书"); return; }
    batchDlSignalRef.current = { cancelled: false };
    setBatchDlLabel("准备中…");
    try {
      const rows = await listBookSources();
      for (let bi = 0; bi < targets.length; bi++) {
        if (batchDlSignalRef.current.cancelled) break;
        const it = targets[bi];
        if (it.kind !== "source") continue;
        const { source_id: sourceId, book_url: bookUrl, title } = it.sb;
        setBatchDlLabel(`下载中 ${bi + 1}/${targets.length}：《${title}》`);
        const row = rows.find((x) => x.id === sourceId);
        if (!row) continue;
        let src;
        try { src = parseBookSourceJson(row.json); } catch { continue; }
        const tocRes = await fetchToc({ sourceId, bookUrl, initialTitle: title }).catch(() => null);
        if (!tocRes || tocRes.toc.length === 0) continue;
        await downloadBook({
          sourceId, bookUrl, toc: tocRes.toc,
          getSrc: async () => src,
          onProgress: (p) => setBatchDlLabel(`下载中 ${bi + 1}/${targets.length}：《${title}》 ${p.done}/${p.total} 章`),
          signal: batchDlSignalRef.current,
        });
      }
    } finally {
      setBatchDlLabel(null);
      setSelecting(false);
      setSelected(new Set());
      setTocVersion((v) => v + 1);
    }
  };

  const handleInfo = (item: ShelfItem) => {
    if (item.kind === "source") {
      onOpenInfo?.({
        title: item.sb.title,
        author: item.sb.author || "",
        coverUrl: item.sb.cover_url || "",
        bookUrl: item.sb.book_url,
        sourceId: item.sb.source_id,
        sourceName: item.sb.source_name,
      });
    }
  };

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setLocalHits([]); setOnlineHits([]); return; }
    const seq = ++searchSeqRef.current;
    setSearchBusy(true);
    try {
      const [local, online] = await Promise.allSettled([
        invoke<Array<{ book_id: number; title: string; format: string; text: string; location: string }>>("search_books", { query: q }),
        searchBookSources(q),
      ]);
      if (seq !== searchSeqRef.current) return;
      setLocalHits(local.status === "fulfilled" ? local.value : []);
      setOnlineHits(online.status === "fulfilled" ? online.value : []);
    } catch {
      // 旧响应被丢弃
    } finally {
      if (seq === searchSeqRef.current) setSearchBusy(false);
    }
  }, []);

  // 从书籍详情点作者跳转：自动打开搜索并执行
  useEffect(() => {
    if (initialSearch && initialSearch.trim()) {
      setShowSearch(true);
      setSearchQuery(initialSearch);
      void runSearch(initialSearch);
    }
  }, [initialSearch, runSearch]);

  const handleSearchJump = (h: { book_id: number; title: string; location: string }) => {
    const book = items.find((i) => i.kind === "local" && i.book.id === h.book_id) as { kind: "local"; book: Book } | undefined;
    if (!book) return;
    onOpenBook(book.book, h.location);
  };

  // ==== 分组过滤 ====
  const filteredItems = useCallback(() => {
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
  }, [items, activeGroup, groups, groupMembers]);

  const visibleItems = filteredItems();
  // 书架内过滤：书名/作者/来源名包含关键字（不区分大小写）
  const filterText = shelfFilter.trim().toLowerCase();
  const filteredVisible = useMemo(() => {
    if (!filterText) return visibleItems;
    return visibleItems.filter((i) => {
      const title = (i.kind === "local" ? i.book.title : i.sb.title).toLowerCase();
      if (title.includes(filterText)) return true;
      if (i.kind === "source") {
        if ((i.sb.author ?? "").toLowerCase().includes(filterText)) return true;
        if ((i.sb.source_name ?? "").toLowerCase().includes(filterText)) return true;
      }
      return false;
    });
  }, [visibleItems, filterText]);
  const sortedVisible = useMemo(
    () => sortShelfItems(filteredVisible, sort.mode, sort.desc),
    [filteredVisible, sort.mode, sort.desc]
  );

  // ==== 手动排序拖拽（legado 手动排序模式）====
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const manualMode = sort.mode === 5;

  // 分组拼贴：取组内前 4 本有封面的书
  const showCollage = groupCollage && viewMode === "shelf" && activeGroup === "all" && layout === "grid";
  const collageGroups = useMemo(() => {
    if (!showCollage) return [];
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
  }, [showCollage, groups, groupMembers, items]);
  const handleDropAt = async (index: number) => {
    setDragOverIndex(null);
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from == null || from === index) return;
    const arr = [...sortedVisible];
    const [moved] = arr.splice(from, 1);
    arr.splice(index, 0, moved);
    try {
      await reorderShelfItems(arr.map(itemMember));
      await Promise.all([refresh(), loadGroups()]);
    } catch (e) {
      showError(String(e));
    }
  };

  const handleGroupPick = async (groupId: number | null) => {
    const targets = items.filter((i) => selected.has(memberKey(itemMember(i))));
    if (targets.length === 0) return;
    const members = targets.map(itemMember);
    if (groupId == null) {
      // 移出所有分组：从每个分组移除
      for (const g of groups) {
        await removeShelfGroupMembers(g.id, members);
      }
    } else {
      await addShelfGroupMembers(groupId, members);
    }
    await Promise.all([loadGroups()]);
    setShowGroupPicker(false);
    setSelected(new Set());
    setSelecting(false);
  };

  // ==== 卡片菜单 ====
  const [menuItem, setMenuItem] = useState<ShelfItem | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 加入书单的目标书（弹窗期间保留，不依赖 menuItem 状态）
  const listTargetRef = useRef<ShelfItem | null>(null);

  const handleMenu = (item: ShelfItem, e: React.MouseEvent) => {
    e.preventDefault();
    setMenuItem(item);
    setSelected(new Set([memberKey(itemMember(item))]));
    // 菜单位置：贴近按钮，避免超出窗口
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: Math.min(rect.left, window.innerWidth - 180), y: rect.bottom + 4 });
  };

  useEffect(() => {
    if (!menuPos) return;
    const close = () => { setMenuPos(null); setMenuItem(null); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [menuPos]);

  const toggleSelect = (item: ShelfItem) => {
    const key = memberKey(itemMember(item));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const menuActions = [
    {
      label: "移动到分组",
      run: () => { setShowGroupPicker(true); setMenuPos(null); setMenuItem(null); },
    },
    {
      label: "加入书单",
      run: () => {
        setMenuPos(null);
        listTargetRef.current = menuItem;
        setMenuItem(null);
        void loadBookLists().then(() => setShowBookListPicker(true)).catch((e) => showError(String(e)));
      },
    },
    {
      label: "移除书架",
      run: () => {
        setMenuPos(null);
        if (menuItem) handleRemove(menuItem);
        setMenuItem(null);
      },
    },
  ];

  const handleBookListPick = async (listId: number) => {
    const targets = listTargetRef.current
      ? [listTargetRef.current]
      : items.filter((i) => selected.has(memberKey(itemMember(i))));
    setShowBookListPicker(false);
    listTargetRef.current = null;
    setSelected(new Set());
    setSelecting(false);
    if (targets.length === 0) return;
    for (const item of targets) {
      const m = itemMember(item);
      await addBookListItem(listId, m.item_kind, m.item_id);
    }
    await loadBookLists();
    if (viewMode === "lists" && activeList === listId) void loadListItems(listId);
  };

  const handleBookListCreate = async (name: string, description?: string) => {
    const targets = listTargetRef.current
      ? [listTargetRef.current]
      : items.filter((i) => selected.has(memberKey(itemMember(i))));
    const id = await createBookList(name, description);
    await loadBookLists();
    if (targets.length > 0) {
      for (const item of targets) {
        const m = itemMember(item);
        await addBookListItem(id, m.item_kind, m.item_id);
      }
      listTargetRef.current = null;
      setSelected(new Set());
      setSelecting(false);
      setShowBookListPicker(false);
    }
  };

  const handleRemoveFromList = async (item: ShelfItem) => {
    if (activeList == null) return;
    const m = itemMember(item);
    await removeBookListItem(activeList, m.item_kind, m.item_id);
    await loadListItems(activeList);
    await loadBookLists();
  };

  const handleDeleteList = async (id: number) => {
    if (!confirm("删除书单？书单内的书籍不会删除。")) return;
    await deleteBookList(id);
    if (activeList === id) setActiveList(null);
    await loadBookLists();
  };

  return (
    <div className="library">
      <header className="library-header">
        <div className="brand">
          <h1>枕书</h1>
          <small>桌面阅读器</small>
        </div>
        <div className="library-actions">
          <button
            className={`btn-icon${showSearch ? " active" : ""}`}
            onClick={() => setShowSearch((s) => !s)}
            aria-label="全文搜索"
            title="全文搜索"
          >
            <SearchIcon size={17} />
          </button>
          <button
            className={`btn btn-ghost${selecting ? " active" : ""}`}
            onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}
            aria-label={selecting ? "退出多选" : "多选"}
            title={selecting ? "退出多选" : "多选"}
          >
            {selecting ? "完成" : "多选"}
          </button>
          <button
            className={`btn-icon${showShelfFilter ? " active" : ""}`}
            onClick={() => { setShowShelfFilter((v) => !v); setShelfFilter(""); }}
            aria-label="过滤书架"
            title="过滤书架（按书名/作者/来源）"
          >
            <FilterIcon size={17} />
          </button>
          <button
            className={`btn-icon${refreshingToc ? " active" : ""}`}
            onClick={handleRefreshToc}
            disabled={refreshingToc}
            aria-label="更新目录"
            title="更新目录（刷新在线书章节）"
          >
            <RefreshIcon size={17} />
          </button>
          <div className="sort-wrap">
            <button
              className={`btn-icon${showSortMenu ? " active" : ""}`}
              onClick={() => setShowSortMenu((v) => !v)}
              aria-label="排序"
              title={`排序：${sortLabel}`}
            >
              <SortIcon size={17} />
            </button>
            {showSortMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setShowSortMenu(false)} />
                <div className="sort-menu card-menu" role="menu" aria-label="排序方式">
                  <button
                    className="card-menu-item"
                    role="menuitemradio"
                    aria-checked={sort.desc}
                    onClick={() => applySort({ ...sort, desc: !sort.desc })}
                  >
                    {sort.desc ? "降序 ↓" : "升序 ↑"}
                  </button>
                  {SORT_LABELS.map((label, i) => (
                    <button
                      key={label}
                      className={`card-menu-item${sort.mode === i ? " active" : ""}`}
                      role="menuitemradio"
                      aria-checked={sort.mode === i}
                      onClick={() => { applySort({ ...sort, mode: i }); setShowSortMenu(false); }}
                    >
                      {label}{sort.mode === i ? ` ${sort.desc ? "↓" : "↑"}` : ""}
                    </button>
                  ))}
                  <div className="sort-menu-divider" />
                  <button
                    className={`card-menu-item${gridOverlay ? " active" : ""}`}
                    role="menuitemcheckbox"
                    aria-checked={gridOverlay}
                    onClick={() => applyGridOverlay(!gridOverlay)}
                  >
                    标题叠加封面{gridOverlay ? " ✓" : ""}
                  </button>
                  <button
                    className={`card-menu-item${groupCollage ? " active" : ""}`}
                    role="menuitemcheckbox"
                    aria-checked={groupCollage}
                    onClick={() => applyGroupCollage(!groupCollage)}
                  >
                    分组显示为卡片{groupCollage ? " ✓" : ""}
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            className="btn-icon"
            onClick={toggleLayout}
            aria-label={layout === "grid" ? "切换为列表" : layout === "list" ? "切换为紧凑" : "切换为网格"}
            title={layout === "grid" ? "列表视图" : layout === "list" ? "紧凑视图" : "网格视图"}
          >
            {layout === "grid" ? <ListIcon size={17} /> : layout === "list" ? <CompactIcon size={17} /> : <GridIcon size={17} />}
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={busy}>
            {busy ? "导入中…" : "导入书籍"}
          </button>
        </div>
      </header>

      <div className="library-tabs" role="tablist" aria-label="书架视图切换">
        <button className={`seg-btn${viewMode === "shelf" ? " active" : ""}`} role="tab" aria-selected={viewMode === "shelf"} onClick={() => setViewMode("shelf")}>书架</button>
        <button className={`seg-btn${viewMode === "lists" ? " active" : ""}`} role="tab" aria-selected={viewMode === "lists"} onClick={() => setViewMode("lists")}>书单</button>
      </div>

      {viewMode === "shelf" && (
        <GroupChips
          groups={groups}
          active={activeGroup}
          onSelect={(k) => { setActiveGroup(k); setSelected(new Set()); setSelecting(false); }}
          onManage={() => setShowGroupManager(true)}
        />
      )}

      {viewMode === "shelf" && showShelfFilter && (
        <div className="shelf-filter-row">
          <input
            autoFocus
            aria-label="过滤书架"
            placeholder="按书名 / 作者 / 来源过滤当前书架"
            value={shelfFilter}
            onChange={(e) => setShelfFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setShelfFilter(""); setShowShelfFilter(false); } }}
          />
          {shelfFilter && (
            <button className="btn-icon" aria-label="清除过滤" onClick={() => setShelfFilter("")}>×</button>
          )}
          <span className="shelf-filter-count">{filteredVisible.length} 本</span>
        </div>
      )}

      {showSearch && (
        <aside className="panel search-panel">
          <h3>搜索</h3>
          <div className="panel-add">
            <input aria-label="搜索关键词" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch(searchQuery)}
              placeholder="输入书名，搜索本地书和在线书源" />
            <button className="btn btn-primary" onClick={() => void runSearch(searchQuery)} disabled={searchBusy || !searchQuery.trim()}>
              {searchBusy ? "搜索中…" : "搜索"}
            </button>
          </div>
          {searchBusy ? (
            <p className="panel-empty"><span className="loading-state"><span className="spinner" /><span>搜索中…</span></span></p>
          ) : searchQuery.trim() && localHits.length === 0 && onlineHits.length === 0 ? (
            <p className="panel-empty">未找到相关书籍</p>
          ) : localHits.length > 0 || onlineHits.length > 0 ? (
            <>
              {localHits.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="section-head">
                    <h4 style={{ margin: 0, fontSize: 14 }}>本地书架</h4>
                    <span className="section-sub">{localHits.length} 本</span>
                  </div>
                  {localHits.map((h) => (
                    <div className="hit-card" key={`local-${h.book_id}`} onClick={() => handleSearchJump(h)} role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSearchJump(h); }}>
                      <div className="hit-info">
                        <span className="hit-title">{h.title}</span>
                        <span className="hit-author">{h.format.toUpperCase()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {onlineHits.length > 0 && (
                <div>
                  <div className="section-head">
                    <h4 style={{ margin: 0, fontSize: 14 }}>在线书源</h4>
                    <span className="section-sub">{onlineHits.length} 条</span>
                  </div>
                  {onlineHits.map((h, i) => (
                    <div className="hit-card" key={`online-${i}`}>
                      <div className="hit-info" onClick={() => onOpenOnlineBook?.(h)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") onOpenOnlineBook?.(h); }}>
                        <span className="hit-title">{h.title}</span>
                        <span className="hit-author">{h.sourceName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </aside>
      )}

      {viewMode === "shelf" ? (
        initialLoading ? (
          <div className="skeleton-grid" aria-label="加载中" aria-busy="true">
            {Array.from({ length: 12 }, (_, i) => (
              <div className="skeleton-card" key={i}>
                <div className="skeleton-cover" />
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><BookIcon size={34} /></span>
            <h2>{activeGroup === "all" ? "书架空空如也，点击导入书籍" : "该分组暂无书籍"}</h2>
            <p>支持 EPUB · PDF · Markdown · TXT 四种格式；也可在「发现」中把在线书加入书架</p>
          </div>
        ) : filteredVisible.length === 0 ? (
          <div className="empty">
            <h2>没有匹配「{shelfFilter}」的书籍</h2>
            <p>试试其他关键字，或清除过滤条件</p>
          </div>
        ) : (
          <>
                <div className={layout === "compact" ? "book-grid-compact" : `book-${layout === "grid" ? "grid" : "list"}`}>
              {collageGroups.map(({ group, members }) => (
                <button
                  key={`collage-${group.id}`}
                  className="group-collage"
                  onClick={() => setActiveGroup(`g:${group.id}`)}
                  aria-label={`打开分组 ${group.name}`}
                  title={group.name}
                >
                  <div className="group-collage-grid">
                    {members.slice(0, 4).map((m) => {
                      const src = m.kind === "local" ? coverUrl(m.book.cover_path) : (m.sb.cover_url || undefined);
                      const label = m.kind === "local" ? formatLabelSafe(m.book.format) : "在线";
                      return src ? (
                        <img key={`${m.kind}-${m.kind === "local" ? m.book.id : m.sb.id}`} className="gc-img" src={src} alt="" loading="lazy" />
                      ) : (
                        <div key={`${m.kind}-${m.kind === "local" ? m.book.id : m.sb.id}`} className="gc-ph"><span>{label}</span></div>
                      );
                    })}
                    {Array.from({ length: Math.max(0, 4 - Math.min(4, members.length)) }, (_, i) => (
                      <div key={`ph-${i}`} className="gc-ph empty" />
                    ))}
                  </div>
                  <span className="group-collage-name">{group.name}</span>
                  <span className="group-collage-count">{members.length} 本</span>
                </button>
              ))}
              {sortedVisible.map((item, index) => (
                <BookCard
                  key={`${item.kind === "local" ? `local-${item.book.id}` : `source-${item.sb.id}`}-v${tocVersion}`}
                  item={item}
                  layout={layout}
                  onOpen={handleOpen}
                  onRemove={handleRemove}
                  onInfo={handleInfo}
                  selectable={selecting}
                  selected={selected.has(memberKey(itemMember(item)))}
                  onToggleSelect={toggleSelect}
                  onMenu={handleMenu}
                  gridOverlay={gridOverlay && layout === "grid"}
                  draggable={manualMode}
                  draggingOver={manualMode && dragOverIndex === index}
                  onDragStart={() => { dragIndexRef.current = index; }}
                  onDragOver={() => setDragOverIndex(index)}
                  onDrop={() => void handleDropAt(index)}
                />
              ))}
            </div>
            {selecting && (
              <div className="batch-bar show">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setSelected(selected.size === visibleItems.length ? new Set() : new Set(visibleItems.map((i) => memberKey(itemMember(i)))));
                  }}
                >
                  {selected.size === visibleItems.length && visibleItems.length > 0 ? "取消全选" : "全选"}
                </button>
                <span className="batch-count">{selected.size} 本</span>
                <button className="btn btn-ghost" disabled={selected.size === 0} onClick={() => setShowGroupPicker(true)}>移动到分组</button>
                <button className="btn btn-ghost" disabled={selected.size === 0} onClick={() => { listTargetRef.current = null; void loadBookLists().then(() => setShowBookListPicker(true)); }}>加入书单</button>
                <button className="btn btn-ghost" disabled={selected.size === 0} onClick={() => setShowBatchDlConfirm(true)}>下载离线</button>
                <button className="btn btn-ghost danger" disabled={selected.size === 0} onClick={handleBatchRemove}>移除</button>
                <button className="btn btn-ghost" onClick={() => { setSelecting(false); setSelected(new Set()); }}>取消</button>
              </div>
            )}
          </>
        )
      ) : (
        <div className="book-lists-view">
          {bookLists.length === 0 && !activeList ? (
            <div className="empty">
              <span className="empty-icon"><BookIcon size={34} /></span>
              <h2>还没有书单</h2>
              <p>把书加入书单，整理你的阅读清单（在书架卡片菜单中操作）</p>
            </div>
          ) : activeList != null ? (
            <div className="book-list-detail">
              <div className="book-list-detail-head">
                <button className="btn btn-ghost" onClick={() => setActiveList(null)}>← 返回书单</button>
                <h3>{bookLists.find((l) => l.id === activeList)?.name ?? ""}</h3>
                <button className="btn btn-ghost danger" onClick={() => void handleDeleteList(activeList)}>删除书单</button>
              </div>
              {listItems.length === 0 ? (
                <div className="empty">
                  <span className="empty-icon"><BookIcon size={30} /></span>
                  <h2>书单为空</h2>
                  <p>在书架卡片菜单中「加入书单」</p>
                </div>
              ) : (
            <div className={layout === "compact" ? "book-grid-compact" : `book-${layout === "grid" ? "grid" : "list"}`}>
                  {listItems.map((item) => (
                    <BookCard
                      key={item.kind === "local" ? `local-${item.book.id}` : `source-${item.sb.id}`}
                      item={item}
                      layout={layout}
                      onOpen={handleOpen}
                      onRemove={(it) => void handleRemoveFromList(it)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="book-lists-grid">
              {bookLists.map((l) => (
                <div className="book-list-card" key={l.id} role="button" tabIndex={0}
                  onClick={() => setActiveList(l.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setActiveList(l.id); }}>
                  <div className="book-list-card-meta">
                    <h3>{l.name}</h3>
                    {l.description && <p>{l.description}</p>}
                    <span className="book-list-count">{l.item_count} 本</span>
                  </div>
                  <button
                    className="book-list-del"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteList(l.id); }}
                    aria-label={`删除书单 ${l.name}`}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmMsg && (
        <ConfirmDialog
          message={confirmMsg}
          onConfirm={() => void doRemove()}
          onCancel={() => { setConfirmMsg(null); pendingRemoveRef.current = null; }}
        />
      )}

      {showBatchDlConfirm && (
        <ConfirmDialog
          message={`确定下载选中的 ${items.filter((i) => i.kind === "source" && selected.has(memberKey(itemMember(i)))).length} 本在线书吗？已缓存章节会跳过。`}
          onConfirm={() => void runBatchDownload()}
          onCancel={() => setShowBatchDlConfirm(false)}
        />
      )}

      {batchDlLabel && (
        <div className="batch-dl-float" role="status">
          <span className="spinner" />
          <span className="batch-dl-label">{batchDlLabel}</span>
          <button
            className="btn btn-ghost"
            onClick={() => { batchDlSignalRef.current.cancelled = true; }}
          >
            取消
          </button>
        </div>
      )}

      {showGroupManager && (
        <GroupManagerDialog
          groups={groups}
          onClose={() => setShowGroupManager(false)}
          onCreate={async (name) => { await createShelfGroup(name); await loadGroups(); }}
          onRename={async (id, name) => { await renameShelfGroup(id, name); await loadGroups(); }}
          onDelete={async (id) => { await deleteShelfGroup(id); await loadGroups(); if (activeGroup === `g:${id}`) setActiveGroup("all"); }}
        />
      )}

      {showGroupPicker && (
        <GroupPickerDialog
          groups={groups}
          currentKey={activeGroup}
          onClose={() => setShowGroupPicker(false)}
          onPick={handleGroupPick}
        />
      )}

      {showBookListPicker && (
        <BookListPickerDialog
          lists={bookLists}
          onClose={() => setShowBookListPicker(false)}
          onPick={handleBookListPick}
          onCreate={handleBookListCreate}
        />
      )}

      {menuPos && menuItem && (
        <div className="card-menu" style={{ left: menuPos.x, top: menuPos.y }} ref={menuRef}>
          {menuActions.map((a) => (
            <button key={a.label} className="card-menu-item" onClick={() => void a.run()}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
