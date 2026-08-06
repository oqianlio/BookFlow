export default function SettingsPage({ onBack }: { onBack: () => void }) {
  return <div><button onClick={onBack}>返回</button><h2>设置</h2></div>;
}
