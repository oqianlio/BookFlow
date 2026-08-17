import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BookCard, { type BookCardLayout, type ShelfItem } from "../components/BookCard";
import ConfirmDialog from "../components/ConfirmDialog";
import GroupChips, { GroupManagerDialog, GroupPickerDialog } from "../components/GroupChips";
import BookListPickerDialog from "../components/BookListPicker";
import { BookIcon, GridIcon, ListIcon, SearchIcon } from "../components/icons";
import { searchBookSources } from "../services/searchService";
import type { SearchHit as OnlineHit } from "../services/searchService";
import {
  importFiles, listBooks, listShelfSourceBooks,
  listShelfGroups, createShelfGroup, renameShelfGroup, deleteShelfGroup,
  listShelfGroupMembers, addShelfGroupMembers, removeShelfGroupMembers,
  removeShelfItems, listBookLists, createBookList, deleteBookList,
  addBookListItem, removeBookListItem, listBookListItems, type Book, type ShelfSourceBook,
  type ShelfGroup, type ShelfMember,
} from "../services/api";
import { useError } from "../components/ErrorDialog";

const LAYOUT_KEY = "library.layout";

function loadLayout(): BookCardLayout {
  const v = localStorage.getItem(LAYOUT_KEY);
  return v === "list" ? "list" : "grid";
}

function itemMember(item: ShelfItem): ShelfMember {
  return item.kind === "local"
    ? { item_kind: "local", item_id: item.book.id }
    : { item_kind: "source", item_id: item.sb.id };
}

function memberKey(m: ShelfMember): string {
  return `${m.item_kind}:${m.item_id}`;
}

export default function LibraryPage({ onOpenBook, onOpenSourceBook, onOpenOnlineBook }: {
  onOpenBook: (b: Book, jumpTo?: string) => void;
  onOpenSourceBook?: (sb: ShelfSourceBook) => void;
  onOpenOnlineBook?: (h: OnlineHit) => void;
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
      const next: BookCardLayout = prev === "grid" ? "list" : "grid";
      localStorage.setItem(LAYOUT_KEY, next);
      return next;
    });
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
            className="btn-icon"
            onClick={toggleLayout}
            aria-label={layout === "grid" ? "切换为列表" : "切换为网格"}
            title={layout === "grid" ? "列表视图" : "网格视图"}
          >
            {layout === "grid" ? <ListIcon size={17} /> : <GridIcon size={17} />}
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
        ) : (
          <>
            <div className={`book-${layout === "grid" ? "grid" : "list"}`}>
              {visibleItems.map((item) => (
                <BookCard
                  key={item.kind === "local" ? `local-${item.book.id}` : `source-${item.sb.id}`}
                  item={item}
                  layout={layout}
                  onOpen={handleOpen}
                  onRemove={handleRemove}
                  selectable={selecting}
                  selected={selected.has(memberKey(itemMember(item)))}
                  onToggleSelect={toggleSelect}
                  onMenu={handleMenu}
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
                <div className={`book-${layout === "grid" ? "grid" : "list"}`}>
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
