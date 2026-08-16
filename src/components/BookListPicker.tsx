import { useState } from "react";
import type { BookList } from "../services/api";
import { PlusIcon } from "./icons";

/** 书单选择/新建弹窗：把书加入已有书单或新建书单 */
export default function BookListPickerDialog({
  lists,
  onClose,
  onPick,
  onCreate,
}: {
  lists: BookList[];
  onClose: () => void;
  onPick: (listId: number) => Promise<void>;
  onCreate: (name: string, description?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const submitCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onCreate(name.trim(), desc.trim() || undefined);
      setCreating(false);
      setName("");
      setDesc("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog dialog-narrow" onClick={(e) => e.stopPropagation()}>
        <h3>加入书单</h3>
        {!creating ? (
          <>
            <div className="group-pick-list">
              {lists.length === 0 && <p className="dialog-empty">还没有书单，新建一个吧</p>}
              {lists.map((l) => (
                <button
                  key={l.id}
                  className="group-pick-row"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true); setErr("");
                    void onPick(l.id).catch((e) => setErr(String(e))).finally(() => setBusy(false));
                  }}
                >
                  <span className="group-pick-name">{l.name}</span>
                  <span className="group-manage-count">{l.item_count} 本</span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost book-list-new" onClick={() => setCreating(true)}>
              <PlusIcon size={14} /> 新建书单
            </button>
          </>
        ) : (
          <div className="group-manage-create book-list-create">
            <input placeholder="书单名称（必填）" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <input placeholder="简介（可选）" value={desc} onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); }} />
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setCreating(false)}>返回</button>
              <button className="btn btn-primary" onClick={() => void submitCreate()} disabled={busy || !name.trim()}>创建并加入</button>
            </div>
          </div>
        )}
        {err && <p className="dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
