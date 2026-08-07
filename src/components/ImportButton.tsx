export default function ImportButton({ onImport, busy }: { onImport: () => void; busy: boolean }) {
  return (
    <button className="btn btn-primary" onClick={onImport} disabled={busy}>
      {busy ? "导入中…" : "导入书籍"}
    </button>
  );
}
