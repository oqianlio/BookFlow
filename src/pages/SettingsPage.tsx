import { useEffect, useState } from "react";
import { SCHEMES, SCHEME_NAMES, Theme, initTheme, setTheme, getTheme } from "../components/theme";
import { getFontSize, setFontSize } from "../components/theme";
import { getTtsRate, setTtsRate } from "../components/TtsBar";
import { loadEyeCare, saveEyeCare, type EyeCareSettings } from "../services/eyeCare";
import { loadReadingSettings, saveReadingSettings } from "../services/readingSettings";

export default function SettingsPage({ onOpenSourceManager }: {
  onOpenSourceManager?: () => void;
}) {
  const [theme, setThemeState] = useState<Theme>({ scheme: "sora", mode: "light" });
  const [fontSize, setFontSizeState] = useState(18);
  const [rate, setRateState] = useState(1);
  const [eyeCare, setEyeCareState] = useState<EyeCareSettings>({ enabled: false, start: "22:00", end: "06:00" });
  const [customBg, setCustomBg] = useState("#f5e9d0");
  const [customFg, setCustomFg] = useState("#2b2b2b");

  useEffect(() => {
    void initTheme().then(() => setThemeState(getTheme()));
    setFontSizeState(getFontSize());
    void getTtsRate().then(setRateState);
    void loadEyeCare().then(setEyeCareState);
    void loadReadingSettings().then((s) => {
      if (s.customBg) setCustomBg(s.customBg);
      if (s.customFg) setCustomFg(s.customFg);
    });
  }, []);

  const selectScheme = (scheme: Theme["scheme"]) => {
    const next = { ...getTheme(), scheme };
    setThemeState(next);
    void setTheme(next);
  };
  const toggleMode = (mode: Theme["mode"]) => {
    const next = { ...getTheme(), mode };
    setThemeState(next);
    // 记录用户手动选择的模式（护眼定时窗口外恢复用）
    localStorage.setItem("reader.manualMode", mode);
    void setTheme(next);
  };
  const updateEyeCare = (patch: Partial<EyeCareSettings>) => {
    setEyeCareState((prev) => {
      const next = { ...prev, ...patch };
      void saveEyeCare(next);
      return next;
    });
  };

  const applyCustomTheme = async () => {
    try {
      const s = await loadReadingSettings();
      await saveReadingSettings({ ...s, bgTheme: "custom", customBg, customFg });
    } catch { /* 静默 */ }
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
            <div className="label">护眼定时</div>
            <div className="hint">设定时间段内自动切换到夜间模式</div>
          </div>
          <div className="segmented" role="group" aria-label="护眼定时">
            <button type="button" className={!eyeCare.enabled ? "active" : ""} onClick={() => updateEyeCare({ enabled: false })}>关</button>
            <button type="button" className={eyeCare.enabled ? "active" : ""} onClick={() => updateEyeCare({ enabled: true })}>开</button>
          </div>
          {eyeCare.enabled && (
            <div className="time-range">
              <input type="time" aria-label="护眼开始时间" value={eyeCare.start} onChange={(e) => updateEyeCare({ start: e.target.value })} />
              <span>至</span>
              <input type="time" aria-label="护眼结束时间" value={eyeCare.end} onChange={(e) => updateEyeCare({ end: e.target.value })} />
            </div>
          )}
        </div>
        <div className="settings-group">
          <div>
            <div className="label">自定义主题</div>
            <div className="hint">设置阅读背景与文字颜色，应用到阅读区</div>
          </div>
          <div className="custom-theme-row">
            <label className="custom-theme-item">
              <span>背景</span>
              <input type="color" aria-label="自定义背景色" value={customBg} onChange={(e) => setCustomBg(e.target.value)} />
            </label>
            <label className="custom-theme-item">
              <span>文字</span>
              <input type="color" aria-label="自定义文字色" value={customFg} onChange={(e) => setCustomFg(e.target.value)} />
            </label>
            <button className="btn btn-soft" onClick={() => void applyCustomTheme()}>应用</button>
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
