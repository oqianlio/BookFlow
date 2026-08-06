import { useEffect, useState } from "react";
import { getFontSize, setFontSize, Theme, initTheme, setTheme, getTheme } from "../components/theme";

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [fontSize, setFontSizeState] = useState(18);

  useEffect(() => {
    void initTheme().then(() => setThemeState(getTheme()));
    setFontSizeState(getFontSize());
  }, []);

  return (
    <div className="settings">
      <header className="library-header">
        <h1>设置</h1>
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
      </header>
      <div className="settings-form">
        <label>
          主题
          <select value={theme} onChange={(e) => { const t = e.target.value as Theme; setThemeState(t); void setTheme(t); }}>
            <option value="light">白天</option>
            <option value="dark">夜间</option>
          </select>
        </label>
        <label>
          字号
          <input type="range" min={12} max={32} value={fontSize}
            onChange={(e) => { const n = +e.target.value; setFontSizeState(n); void setFontSize(n); }} />
          <span>{fontSize}px</span>
        </label>
      </div>
    </div>
  );
}
