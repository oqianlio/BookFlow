import { useState } from "react";
import type { ShelfGroup } from "../services/api";
import { PlusIcon, GearIcon } from "./icons";

/** 书架顶部分组 chips：全部 / 默认（无分组）/ 自定义分组… + 管理入口 */
export default function GroupChips({
  groups,
  active,
  onSelect,
  onManage,
}: {
  groups: ShelfGroup[];
  active: string; // "all" | "default" | `g:${id}`
  onSelect: (key: string) => void;
  onManage: () => void;
}) {
  const chips: Array<{ key: string; label: string }> = [
    { key: "all", label: "全部" },
    { key: "default", label: "默认" },
    ...groups.map((g) => ({ key: `g:${g.id}`, label: g.name })),
  ];
  return (
    <div className="group-chips">
      <div className="group-chips-scroll">
        {chips.map((c) => (
          <button
            key={c.key}
            className={`chip${active === c.key ? " active" : ""}`}
            onClick={() => onSelect(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <button className="btn-icon chip-manage" onClick={onManage} aria-label="管理分组" title="管理分组">
        <GearIcon size={16} />
      </button>
    </div>
  );
}

/** 分组管理弹窗：新建 / 重命名 / 删除 */
export function GroupManagerDialog({
  groups,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  groups: ShelfGroup[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [err, setErr] = useState("");

  const submitCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onCreate(name.trim());
      setName("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog dialog-narrow" onClick={(e) => e.stopPropagation()}>
        <h3>管理分组</h3>
        <div className="group-manage-list">
          {groups.length === 0 && <p className="dialog-empty">还没有分组，先新建一个吧</p>}
          {groups.map((g) => (
            <div className="group-manage-row" key={g.id}>
              {editing === g.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void (async () => {
                          setBusy(true);
                          try { await onRename(g.id, editName.trim()); setEditing(null); } catch (e2) { setErr(String(e2)); }
                          finally { setBusy(false); }
                        })();
                      }
                    }}
                    autoFocus
                  />
                  <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
                </>
              ) : (
                <>
                  <span className="group-manage-name">{g.name}</span>
                  <span className="group-manage-count">{g.member_count} 本</span>
                  <button className="btn btn-ghost" onClick={() => { setEditing(g.id); setEditName(g.name); }}>重命名</button>
                  <button
                    className="btn btn-ghost danger"
                    onClick={() => {
                      if (confirm(`删除分组「${g.name}」？分组内书籍不会删除。`)) void onDelete(g.id);
                    }}
                  >删除</button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="group-manage-create">
          <input
            placeholder="新分组名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); }}
          />
          <button className="btn btn-primary" onClick={() => void submitCreate()} disabled={busy || !name.trim()}>
            <PlusIcon size={14} /> 新建
          </button>
        </div>
        {err && <p className="dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/** 分组选择弹窗：把选中的书移动到指定分组（覆盖式赋值） */
export function GroupPickerDialog({
  groups,
  currentKey,
  onClose,
  onPick,
}: {
  groups: ShelfGroup[];
  currentKey: string; // "all" | "default" | `g:${id}`
  onClose: () => void;
  onPick: (groupId: number | null) => Promise<void>; // null = 移出所有分组（默认）
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog dialog-narrow" onClick={(e) => e.stopPropagation()}>
        <h3>移动到分组</h3>
        <div className="group-pick-list">
          <button
            className={`group-pick-row${currentKey === "default" ? " active" : ""}`}
            disabled={busy}
            onClick={() => {
              setBusy(true); setErr("");
              void onPick(null).catch((e) => setErr(String(e))).finally(() => setBusy(false));
            }}
          >
            <span className="group-pick-name">默认（无分组）</span>
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              className={`group-pick-row${currentKey === `g:${g.id}` ? " active" : ""}`}
              disabled={busy}
              onClick={() => {
                setBusy(true); setErr("");
                void onPick(g.id).catch((e) => setErr(String(e))).finally(() => setBusy(false));
              }}
            >
              <span className="group-pick-name">{g.name}</span>
              <span className="group-manage-count">{g.member_count} 本</span>
            </button>
          ))}
        </div>
        {err && <p className="dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
