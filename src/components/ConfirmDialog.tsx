// 自定义确认对话框：替换 window.confirm，跟随应用主题且可测试
export default function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="error-dialog-overlay">
      <div className="error-dialog" role="alertdialog" aria-label="确认">
        <h3>确认操作</h3>
        <p className="error-dialog-message">{message}</p>
        <div className="error-dialog-actions">
          <button className="btn btn-primary" onClick={onConfirm}>确定</button>
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
