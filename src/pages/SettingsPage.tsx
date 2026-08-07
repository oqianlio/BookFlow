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
    <div className="settings page">
      <header className="library-header">
        <h1>设置</h1>
        <button className="btn btn-ghost" onClick={onBack}>返回书架</button>
      </header>
      <div className="settings-form">
        <div className="settings-group">
          <div>
            <div className="label">主题</div>
            <div className="hint">适应夜间阅读环境</div>
          </div>
          <div className="segmented" role="group" aria-label="主题">
            <button
              type="button"
              className={theme === "light" ? "active" : ""}
              onClick={() => { setThemeState("light"); void setTheme("light"); }}
            >白天</button>
            <button
              type="button"
              className={theme === "dark" ? "active" : ""}
              onClick={() => { setThemeState("dark"); void setTheme("dark"); }}
            >夜间</button>
          </div>
        </div>
        <div className="settings-group">
          <div>
            <div className="label">字号</div>
            <div className="hint">调节阅读正文大小</div>
          </div>
          <div className="range-row">
            <input
              type="range"
              min={12}
              max={32}
              value={fontSize}
              aria-label="字号"
              onChange={(e) => { const n = +e.target.value; setFontSizeState(n); void setFontSize(n); }}
            />
            <span className="range-value">{fontSize}px</span>
          </div>
        </div>
      </div>
    </div>
  );
}
