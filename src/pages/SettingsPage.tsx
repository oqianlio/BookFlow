import { useEffect, useState } from "react";
import { SCHEMES, SCHEME_NAMES, Theme, initTheme, setTheme, getTheme } from "../components/theme";
import { getFontSize, setFontSize } from "../components/theme";
import { getTtsRate, setTtsRate } from "../components/TtsBar";

export default function SettingsPage({ onOpenSourceManager }: {
  onOpenSourceManager?: () => void;
}) {
  const [theme, setThemeState] = useState<Theme>({ scheme: "sora", mode: "light" });
  const [fontSize, setFontSizeState] = useState(18);
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    void initTheme().then(() => setThemeState(getTheme()));
    setFontSizeState(getFontSize());
    void getTtsRate().then(setRateState);
  }, []);

  const selectScheme = (scheme: Theme["scheme"]) => {
    const next = { ...getTheme(), scheme };
    setThemeState(next);
    void setTheme(next);
  };
  const toggleMode = (mode: Theme["mode"]) => {
    const next = { ...getTheme(), mode };
    setThemeState(next);
    void setTheme(next);
  };

  return (
    <div className="my page">
      <header className="library-header"><h1>我的</h1></header>
      <div className="my-form">
        <div className="settings-group">
          <div>
            <div className="label">主题方案</div>
            <div className="hint">选择配色方案</div>
          </div>
          <div className="segmented" role="group" aria-label="主题方案">
            {SCHEMES.map((s) => (
              <button key={s} type="button" className={theme.scheme === s ? "active" : ""} onClick={() => selectScheme(s)}>
                {SCHEME_NAMES[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-group">
          <div>
            <div className="label">明暗模式</div>
            <div className="hint">适应夜间阅读环境</div>
          </div>
          <div className="segmented" role="group" aria-label="明暗模式">
            <button type="button" className={theme.mode === "light" ? "active" : ""} onClick={() => toggleMode("light")}>白天</button>
            <button type="button" className={theme.mode === "dark" ? "active" : ""} onClick={() => toggleMode("dark")}>夜间</button>
          </div>
        </div>
        <div className="settings-group">
          <div>
            <div className="label">字号</div>
            <div className="hint">调节阅读正文大小</div>
          </div>
          <div className="range-row">
            <input type="range" min={12} max={32} value={fontSize} aria-label="字号"
              onChange={(e) => { const n = +e.target.value; setFontSizeState(n); void setFontSize(n); }} />
            <span className="range-value">{fontSize}px</span>
          </div>
        </div>
        <div className="settings-group">
          <div>
            <div className="label">朗读语速</div>
            <div className="hint">调节 TTS 朗读速度</div>
          </div>
          <div className="range-row">
            <input type="range" min={0.5} max={2} step={0.1} value={rate} aria-label="朗读语速"
              onChange={(e) => { const n = +e.target.value; setRateState(n); void setTtsRate(n); }} />
            <span className="range-value">{rate.toFixed(1)}x</span>
          </div>
        </div>
        <div className="settings-group">
          <div>
            <div className="label">书源管理</div>
            <div className="hint">管理书源列表，支持分组、导入、调试</div>
          </div>
          {onOpenSourceManager && <button className="btn btn-soft" onClick={onOpenSourceManager}>打开</button>}
        </div>
        <div className="settings-group">
          <div>
            <div className="label">关于</div>
            <div className="hint">枕书 · 基于 legado 3.0 规则的桌面阅读器</div>
          </div>
        </div>
      </div>
    </div>
  );
}
