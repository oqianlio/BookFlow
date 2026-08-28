import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { deleteBookSource, listBookSources, setBookSourceEnabled, writeTextFile, listSubscriptions, addSubscription, deleteSubscription, setSubscriptionChecked, type BookSource, type SubscriptionRow } from "../services/api";
import { commitBookSource, importBookSourceFromFile, importBookSourceFromUrl, sourceUsesJs } from "../services/bookSourceImport";
import { syncSubscription } from "../services/sourceSubscription";
import { verifySources, invalidGroupNames, respondTimeOf, type VerifyResult } from "../services/sourceVerify";
import { useError } from "./ErrorDialog";
import ConfirmDialog from "./ConfirmDialog";

export function groupSources(sources: BookSource[]): Array<{ group: string; items: BookSource[] }> {
  const map = new Map<string, BookSource[]>();
  const addToGroup = (g: string, s: BookSource) => {
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  };
  for (const s of sources) {
    let groups: string[] = [];
    try {
      const parsed = JSON.parse(s.json);
      // legado 原版支持多分组：bookSourceGroup 用英文逗号分隔，书源同时出现在多个分组
      const raw = String(parsed?.bookSourceGroup ?? "").trim();
      groups = raw
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
    } catch { /* 解析失败归未分组 */ }
    if (groups.length === 0) {
      addToGroup("未分组", s);
    } else {
      for (const g of groups) addToGroup(g, s);
    }
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

export default function BookSourceManager({ onDebug, onBack }: {
  onDebug?: (sourceId: number, sourceName: string) => void;
  onBack?: () => void;
}) {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "name" | "respond">("default");
  const { showError } = useError();
  const [pendingSources, setPendingSources] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setSources(await listBookSources()); } catch (e) { showError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const [confirmJs, setConfirmJs] = useState<{ msg: string; proceed: () => void } | null>(null);

  // ==== 批量验证 / 删除失败源 ====
  // 检测配置（原版 CheckSource.putConfig / CacheManager 对应物：localStorage 持久化）
  const VERIFY_CFG_KEY = "sourceVerify.config";
  const loadVerifyConfig = (): { keyword: string; concurrency: number; checks: { search: boolean; toc: boolean; content: boolean } } => {
    try {
      const raw = localStorage.getItem(VERIFY_CFG_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          keyword: typeof p.keyword === "string" ? p.keyword : "我的",
          concurrency: Number.isFinite(p.concurrency) && p.concurrency >= 1 ? p.concurrency : 10,
          checks: { search: true, toc: true, content: true, ...(p.checks ?? {}) },
        };
      }
    } catch { /* 损坏配置回退默认 */ }
    return { keyword: "我的", concurrency: 10, checks: { search: true, toc: true, content: true } };
  };
  const [verifyConfig, setVerifyConfig] = useState(loadVerifyConfig);
  const updateVerifyConfig = (patch: Partial<typeof verifyConfig>) => {
    setVerifyConfig((prev) => {
      const next = { ...prev, ...patch, checks: patch.checks ? { ...prev.checks, ...patch.checks } : prev.checks };
      try { localStorage.setItem(VERIFY_CFG_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  const [verifying, setVerifying] = useState(false);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult> | null>(null);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelVerifyRef = useRef(false);

  const handleVerify = async () => {
    if (verifying) return;
    const enabled = sources.filter((s) => s.enabled);
    if (enabled.length === 0) return;
    setVerifying(true);
    setVerifyResults(new Map());
    setVerifyProgress({ done: 0, total: enabled.length });
    cancelVerifyRef.current = false;
    try {
      const results = await verifySources(enabled, {
        keyword: verifyConfig.keyword,
        concurrency: verifyConfig.concurrency,
        checks: verifyConfig.checks,
        shouldCancel: () => cancelVerifyRef.current,
        onProgress: (done, total, r) => {
          setVerifyProgress({ done, total });
          setVerifyResults((prev) => { const m = new Map(prev ?? []); m.set(r.id, r); return m; });
        },
      });
      setVerifyResults(new Map(results.filter(Boolean).map((r) => [r.id, r])));
      // 学习原版：检测结果已写入书源分组并持久化，刷新列表展示失效分组（如"搜索失效"）
      await refresh();
    } catch (e) {
      showError(String(e));
    } finally {
      setVerifying(false);
      setVerifyProgress(null);
    }
  };

  const okCount = verifyResults ? [...verifyResults.values()].filter((r) => r.ok).length : 0;
  // 学习原版 getInvalidGroupNames：失效书源 = 分组含"失效"或"校验超时"（持久化于书源 JSON，重启仍有效）
  const invalidSources = sources.filter((s) => invalidGroupNames(s.json).length > 0);

  const handleDeleteInvalid = () => {
    if (invalidSources.length === 0) return;
    const names = invalidSources.slice(0, 6).map((s) => s.name).join("、");
    setConfirmJs({
      msg: `将删除 ${invalidSources.length} 个失效书源（分组含"失效"或"校验超时"）：${names}${invalidSources.length > 6 ? ` 等 ${invalidSources.length} 个` : ""}。此操作不可撤销，继续？`,
      proceed: () => {
        setConfirmJs(null);
        void (async () => {
          let deleted = 0;
          for (const s of invalidSources) {
            try { await deleteBookSource(s.id); deleted++; } catch { /* 单个失败继续 */ }
          }
          setVerifyResults(null);
          setImportMsg(`已删除 ${deleted} 个失效书源`);
          await refresh();
        })();
      },
    });
  };

  const importSingle = async (bs: any) => {
    let existing: Set<string>;
    try {
      existing = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(String(e));
      return;
    }
    if (existing.has(bs.bookSourceUrl)) {
      setImportMsg(`书源已存在，跳过：${bs.bookSourceName}`);
      await refresh();
      return;
    }
    await commitBookSource(bs);
    await refresh();
  };

  const handleImportResult = async (bookSources: any[]) => {
    if (bookSources.length === 1) {
      const bs = bookSources[0];
      // 含 JS 脚本的书源需确认后导入（自定义确认框）
      if (sourceUsesJs(bs)) {
        setConfirmJs({
          msg: "此书源包含可在本机执行的 JS 脚本，仅导入你信任的书源。继续？",
          proceed: () => { setConfirmJs(null); void importSingle(bs); },
        });
        return;
      }
      await importSingle(bs);
      return;
    }
    let existingUrls: Set<string>;
    try {
      existingUrls = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(String(e));
      return;
    }
    setPendingSources(bookSources);
    setExistingUrls(existingUrls);
    // 默认勾选本地不存在的新书源；已存在的显示但不勾选
    setSelected(new Set(bookSources.map((_, i) => i).filter((i) => !existingUrls.has(bookSources[i].bookSourceUrl))));
    setImportMsg(null);
  };

  const confirmImportSelection = async () => {
    if (!pendingSources) return;
    let existing: Set<string>;
    try {
      existing = new Set((await listBookSources()).map((s) => s.url));
    } catch (e) {
      showError(`读取现有书源失败：${String(e)}`);
      return;
    }
    const dedup = new Set(existing);
    let added = 0, skipped = 0;
    for (const i of selected) {
      const bs = pendingSources[i];
      if (dedup.has(bs.bookSourceUrl)) { skipped++; continue; }
      dedup.add(bs.bookSourceUrl);
      try {
        await commitBookSource(bs);
        added++;
      } catch {
        skipped++;
      }
    }
    setImportMsg(`成功导入 ${added} 个，跳过 ${skipped} 个`);
    setPendingSources(null);
    await refresh();
  };

  const toggleSelect = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  };

  const handleFileImport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const result = await importBookSourceFromFile(path);
      await handleImportResult(result.bookSources);
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const result = await importBookSourceFromUrl(url.trim());
      await handleImportResult(result.bookSources);
      setUrl("");
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBookSource(id);
      await refresh();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleToggleEnable = async (id: number, enabled: boolean) => {
    try {
      await setBookSourceEnabled(id, enabled);
      await refresh();
    } catch (e) {
      showError(String(e));
    }
  };

  const toggleGroup = (g: string) => {
    const next = new Set(collapsed);
    if (next.has(g)) next.delete(g); else next.add(g);
    setCollapsed(next);
  };

  // ==== 复制 / 导出 ====
  const handleCopy = async (s: BookSource) => {
    try {
      const text = JSON.stringify(JSON.parse(s.json), null, 2);
      await navigator.clipboard.writeText(text);
      setImportMsg(`已复制书源 JSON：${s.name}`);
    } catch (e) {
      showError(`复制失败：${String(e)}`);
    }
  };

  const handleExport = async (s: BookSource) => {
    try {
      const picked = await save({
        defaultPath: `${s.name}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked) return;
      await writeTextFile(picked, JSON.stringify(JSON.parse(s.json), null, 2));
      setImportMsg(`已导出：${s.name}`);
    } catch (e) {
      showError(`导出失败：${String(e)}`);
    }
  };

  const handleExportAll = async () => {
    try {
      const picked = await save({
        defaultPath: "书源合集.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked) return;
      const all = sources.map((s) => JSON.parse(s.json));
      await writeTextFile(picked, JSON.stringify(all, null, 2));
      setImportMsg(`已导出 ${all.length} 个书源`);
    } catch (e) {
      showError(`导出失败：${String(e)}`);
    }
  };

  // ==== 订阅源 ====
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [subUrl, setSubUrl] = useState("");
  const [syncBusy, setSyncBusy] = useState<number | null>(null);
  const [syncAllBusy, setSyncAllBusy] = useState(false);

  const refreshSubs = useCallback(async () => {
    try { setSubs(await listSubscriptions()); } catch (e) { showError(String(e)); }
  }, [showError]);
  useEffect(() => { void refreshSubs(); }, [refreshSubs]);

  // 自动刷新：打开书源管理时，超过 24h 未检查的订阅自动同步（失败汇总提示）
  const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listSubscriptions();
        if (cancelled) return;
        const due = list.filter((sub) => {
          const last = sub.last_checked_at;
          return last == null || Date.now() - last * 1000 > AUTO_REFRESH_MS;
        });
        let failed = 0;
        for (const sub of due) {
          try {
            const r = await syncSubscription(sub);
            if (cancelled) return;
            void setSubscriptionChecked(sub.id).catch(() => {});
            if (r.added > 0 || r.updated > 0) setImportMsg(`订阅「${sub.name}」自动同步：新增 ${r.added}，更新 ${r.updated}`);
          } catch {
            failed++;
            console.warn(`[sources] 订阅「${sub.name}」自动同步失败`);
          }
        }
        if (!cancelled && failed > 0) {
          setImportMsg(`${failed}/${due.length} 个订阅自动同步失败（网络或地址失效），可稍后手动同步`);
        }
      } catch { /* 列表加载失败静默（refreshSubs 已有错误提示路径） */ }
    })();
    return () => { cancelled = true; };
  }, [showError]);

  const handleAddSub = async () => {
    if (!subUrl.trim() || busy) return;
    setBusy(true);
    try {
      await addSubscription(subUrl.trim());
      setSubUrl("");
      await refreshSubs();
    } catch (e) {
      showError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSyncSub = async (sub: SubscriptionRow) => {
    setSyncBusy(sub.id);
    try {
      const r = await syncSubscription(sub);
      await setSubscriptionChecked(sub.id);
      await refreshSubs();
      setImportMsg(`同步完成：新增 ${r.added}，更新 ${r.updated}，失败 ${r.failed}`);
    } catch (e) {
      showError(String(e));
    } finally {
      setSyncBusy(null);
    }
  };

  const handleSyncAll = async () => {
    if (syncAllBusy || subs.length === 0) return;
    setSyncAllBusy(true);
    let added = 0, updated = 0, failed = 0;
    for (const sub of subs) {
      try {
        const r = await syncSubscription(sub);
        await setSubscriptionChecked(sub.id);
        added += r.added; updated += r.updated; failed += r.failed;
      } catch {
        failed++;
      }
    }
    await refreshSubs();
    setImportMsg(`全部同步完成：新增 ${added}，更新 ${updated}，失败 ${failed}`);
    setSyncAllBusy(false);
  };

  return (
    <div className="source-manager page">
      <header className="library-header">
        <div className="brand"><h1>书源管理</h1></div>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>返回</button>}
      </header>
      <div className="book-source-manager">
        <h3>书源</h3>
      {sources.length === 0 ? (
        <p className="panel-empty">暂无书源</p>
      ) : (
        <>
          <div className="source-filter-row">
            <input
              className="source-filter"
              aria-label="搜索书源"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书源名称或网址"
            />
            <select
              className="source-sort"
              aria-label="书源排序"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
            >
              <option value="default">默认顺序</option>
              <option value="name">按名称</option>
              <option value="respond">按响应速度</option>
            </select>
          </div>
          <div className="source-verify-bar">
            <button
              className="btn btn-ghost"
              onClick={() => void handleVerify()}
              disabled={verifying || sources.filter((s) => s.enabled).length === 0}
            >
              {verifying ? `验证中 ${verifyProgress?.done ?? 0}/${verifyProgress?.total ?? 0}…` : "批量验证（启用源）"}
            </button>
            {verifying && (
              <button className="btn btn-ghost" onClick={() => { cancelVerifyRef.current = true; }}>取消</button>
            )}
            {!verifying && invalidSources.length > 0 && (
              <>
                <button className="btn btn-primary" onClick={handleDeleteInvalid}>
                  删除失效源（{invalidSources.length}）
                </button>
                {verifyResults && <span className="verify-summary">可用 {okCount} / {verifyResults.size}</span>}
              </>
            )}
          </div>
          <div className="source-verify-config">
            <label>关键字
              <input
                aria-label="检测关键字"
                value={verifyConfig.keyword}
                onChange={(e) => updateVerifyConfig({ keyword: e.target.value })}
                placeholder="我的"
              />
            </label>
            <label>并发
              <input
                aria-label="检测并发数"
                type="number" min={1} max={30}
                value={verifyConfig.concurrency}
                onChange={(e) => updateVerifyConfig({ concurrency: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <span className="verify-config-checks">
              {(["search", "toc", "content"] as const).map((k) => (
                <label key={k} className="verify-config-check">
                  <input
                    type="checkbox"
                    checked={verifyConfig.checks[k]}
                    onChange={(e) => updateVerifyConfig({ checks: { [k]: e.target.checked } as any })}
                  />
                  {k === "search" ? "搜索" : k === "toc" ? "目录" : "正文"}
                </label>
              ))}
            </span>
          </div>
          {(() => {
            const filtered = query.trim()
              ? sources.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()) || s.url.toLowerCase().includes(query.trim().toLowerCase()))
              : sources;
            if (filtered.length === 0) return <p className="panel-empty">无匹配书源</p>;
            // 排序（原版 BookSourceSort：名称 / 响应耗时）
            const sorted = sortMode === "name"
              ? [...filtered].sort((a, b) => a.name.localeCompare(b.name, "zh"))
              : sortMode === "respond"
                ? [...filtered].sort((a, b) => (respondTimeOf(a.json) ?? 999999) - (respondTimeOf(b.json) ?? 999999))
                : filtered;
            return groupSources(sorted).map(({ group, items }) => {
              const isCollapsed = collapsed.has(group);
              return (
                <div key={group}>
                  <div className="source-group-head" onClick={() => toggleGroup(group)} role="button" aria-expanded={!isCollapsed}>
                    <span className={`caret${isCollapsed ? "" : " open"}`}>▶</span>
                    <span>{group}</span>
                    <span className="count">{items.length}</span>
                  </div>
                  {!isCollapsed && (
                    <ul className="source-list">
                      {items.map((s) => (
                        <li key={s.id}>
                          <div className="source-info">
                            <span className="source-name">{s.name}</span>
                            <span className="source-url">{s.url}</span>
                            {verifyResults?.has(s.id) && (() => {
                              const r = verifyResults.get(s.id)!;
                              // ok 且无附加标记 → 绿；ok 但目录/正文标记 → 黄；失败 → 红
                              return r.ok && !r.reason
                                ? <span className="verify-badge ok" title={`${r.ms}ms`}>✓ {r.count}本</span>
                                : r.ok
                                  ? <span className="verify-badge warn" title={`${r.ms}ms`}>{r.reason}</span>
                                  : <span className="verify-badge fail" title={r.reason}>{r.reason}</span>;
                            })()}
                          </div>
                          <div className="source-actions">
                            <input
                              type="checkbox"
                              aria-label={`启用 ${s.name}`}
                              checked={s.enabled}
                              onChange={(e) => void handleToggleEnable(s.id, e.target.checked)}
                            />
                            <button className="btn btn-ghost" onClick={() => onDebug?.(s.id, s.name)}>调试</button>
                            <button className="btn btn-ghost" onClick={() => void handleCopy(s)}>复制</button>
                            <button className="btn btn-ghost" onClick={() => void handleExport(s)}>导出</button>
                            <button className="btn btn-ghost" onClick={() => void handleDelete(s.id)}>删除</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            });
          })()}
        </>
      )}
      <h3 className="source-import-title">导入书源</h3>
      <div className="source-import">
        <button className="btn btn-ghost" onClick={() => void handleFileImport()}>从文件导入</button>
        <button className="btn btn-ghost" onClick={() => void handleExportAll()}>导出全部</button>
        <div className="source-import-row">
          <input
            aria-label="书源网址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleUrlImport()}
            placeholder="粘贴书源 JSON 网址"
          />
          <button className="btn btn-primary" onClick={() => void handleUrlImport()} disabled={busy || !url.trim()}>
            {busy ? "导入中…" : "从网址导入"}
          </button>
        </div>
      </div>
      {pendingSources && (
        <div className="import-confirm">
          <h4>确认导入书源</h4>
          <ul className="import-confirm-list">
            {pendingSources.map((bs, i) => (
              <li key={i}>
                <input
                  type="checkbox"
                  aria-label={bs.bookSourceName}
                  checked={selected.has(i)}
                  onChange={() => toggleSelect(i)}
                />
                <span className="import-confirm-name">{bs.bookSourceName}</span>
                <span className="import-confirm-url">{bs.bookSourceUrl}</span>
                {existingUrls.has(bs.bookSourceUrl) && <span className="import-confirm-existing">已有</span>}
                {sourceUsesJs(bs) && <span className="import-confirm-js">含脚本</span>}
              </li>
            ))}
          </ul>
          <div className="import-confirm-actions">
            <button className="btn btn-primary" onClick={() => void confirmImportSelection()} disabled={selected.size === 0}>
              导入选中 {selected.size} 个
            </button>
            <button className="btn btn-ghost" onClick={() => setPendingSources(null)}>取消</button>
          </div>
        </div>
      )}
      {importMsg && <p className="error import-msg">{importMsg}</p>}

      <h3 className="source-import-title">订阅源</h3>
      <div className="source-import">
        <div className="source-import-row">
          <input
            aria-label="订阅源网址"
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAddSub()}
            placeholder="订阅远程书源合集 JSON 地址"
          />
          <button className="btn btn-primary" onClick={() => void handleAddSub()} disabled={busy || !subUrl.trim()}>
            {busy ? "订阅中…" : "订阅"}
          </button>
        </div>
      </div>
      {subs.length === 0 ? (
        <p className="panel-empty">暂无订阅源，粘贴远程书源合集地址开始订阅</p>
      ) : (
        <>
          <div className="source-import-row">
            <span className="source-hint">打开本页面时自动同步超过 24 小时未检查的订阅</span>
            <button className="btn btn-ghost" onClick={() => void handleSyncAll()} disabled={syncAllBusy}>
              {syncAllBusy ? "同步中…" : "全部同步"}
            </button>
          </div>
          <ul className="source-list">
            {subs.map((sub) => (
              <li key={sub.id}>
                <div className="source-info">
                  <span className="source-name">{sub.name}</span>
                  <span className="source-url">{sub.url}</span>
                </div>
                <div className="source-actions">
                  <button className="btn btn-ghost" onClick={() => void handleSyncSub(sub)} disabled={syncBusy === sub.id}>
                    {syncBusy === sub.id ? "同步中…" : "同步"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => void (async () => { try { await deleteSubscription(sub.id); await refreshSubs(); } catch (e) { showError(String(e)); } })()}>删除</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
      {confirmJs && (
        <ConfirmDialog
          message={confirmJs.msg}
          onConfirm={confirmJs.proceed}
          onCancel={() => setConfirmJs(null)}
        />
      )}
    </div>
  );
}
