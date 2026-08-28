import { BG_THEMES, FONT_PRESETS, type ReadingSettings } from "../services/readingSettings";

interface ReaderSettingsPanelProps {
  settings: ReadingSettings;
  onUpdate: (patch: Partial<ReadingSettings>) => void;
  isLocal: boolean;
}

export default function ReaderSettingsPanel({ settings, onUpdate, isLocal }: ReaderSettingsPanelProps) {
  return (
    <div className="panel reader-settings-panel">
      <h3>阅读设置</h3>
      {!isLocal && (
        <div className="settings-group">
          <label className="settings-label">翻页模式</label>
          <div className="segmented" role="group" aria-label="翻页模式">
            {(["cover", "slide", "scroll"] as const).map((m) => (
              <button key={m} type="button" className={settings.pageMode === m ? "active" : ""}
                onClick={() => onUpdate({ pageMode: m })}>
                {{ cover: "覆盖", slide: "滑动", scroll: "滚动" }[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="settings-group">
        <label className="settings-label">字号 {settings.fontSizePx}px</label>
        <div className="range-row font-size-row">
          <button type="button" className="btn btn-ghost btn-step" aria-label="减小字号"
            onClick={() => onUpdate({ fontSizePx: Math.max(14, settings.fontSizePx - 1) })}>A−</button>
          <input type="range" min={14} max={24} value={settings.fontSizePx} aria-label="字号"
            onChange={(e) => onUpdate({ fontSizePx: Number(e.target.value) })} />
          <button type="button" className="btn btn-ghost btn-step" aria-label="增大字号"
            onClick={() => onUpdate({ fontSizePx: Math.min(24, settings.fontSizePx + 1) })}>A+</button>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">行距 {settings.lineHeight.toFixed(1)}</label>
        <div className="range-row">
          <input type="range" min={1.4} max={2.4} step={0.1} value={settings.lineHeight} aria-label="行距"
            onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })} />
          <span className="range-value">{settings.lineHeight.toFixed(1)}</span>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">字间距 {settings.letterSpacingPx.toFixed(1)}px</label>
        <div className="range-row">
          <input type="range" min={0} max={4} step={0.1} value={settings.letterSpacingPx} aria-label="字间距"
            onChange={(e) => onUpdate({ letterSpacingPx: Number(e.target.value) })} />
          <span className="range-value">{settings.letterSpacingPx.toFixed(1)}</span>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">段间距 {settings.paragraphSpacingPx}px</label>
        <div className="range-row">
          <input type="range" min={0} max={24} step={1} value={settings.paragraphSpacingPx} aria-label="段间距"
            onChange={(e) => onUpdate({ paragraphSpacingPx: Number(e.target.value) })} />
          <span className="range-value">{settings.paragraphSpacingPx}</span>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">首行缩进 {settings.indentEm.toFixed(1)}em</label>
        <div className="range-row">
          <input type="range" min={0} max={2} step={0.1} value={settings.indentEm} aria-label="首行缩进"
            onChange={(e) => onUpdate({ indentEm: Number(e.target.value) })} />
          <span className="range-value">{settings.indentEm.toFixed(1)}</span>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">加粗</label>
        <div className="segmented" role="group" aria-label="加粗">
          <button type="button" className={!settings.bold ? "active" : ""} onClick={() => onUpdate({ bold: false })}>正常</button>
          <button type="button" className={settings.bold ? "active" : ""} onClick={() => onUpdate({ bold: true })}>加粗</button>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">字体</label>
        <div className="segmented" role="group" aria-label="字体">
          {FONT_PRESETS.map((f) => (
            <button key={f.id} type="button" className={settings.fontFamily === f.id ? "active" : ""}
              onClick={() => onUpdate({ fontFamily: f.id })}>{f.name}</button>
          ))}
        </div>
        <input className="font-custom-input" placeholder="自定义字体名（CSS font-family）"
          value={FONT_PRESETS.some((f) => f.id === settings.fontFamily) ? "" : settings.fontFamily}
          onChange={(e) => onUpdate({ fontFamily: e.target.value || "serif" })} aria-label="自定义字体" />
      </div>
      <div className="settings-group">
        <label className="settings-label">背景</label>
        <div className="bg-theme-options">
          {BG_THEMES.map((t) => (
            <button key={t.id} type="button" className={`bg-theme-swatch${settings.bgTheme === t.id ? " active" : ""}`}
              style={{ background: t.bg }} aria-label={t.name} title={t.name}
              onClick={() => onUpdate({ bgTheme: t.id })} />
          ))}
          {settings.customBg && (
            <button type="button"
              className={`bg-theme-swatch bg-theme-swatch-custom${settings.bgTheme === "custom" ? " active" : ""}`}
              style={{ background: settings.customBg }} aria-label="自定义" title="自定义"
              onClick={() => onUpdate({ bgTheme: "custom" })} />
          )}
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">简繁</label>
        <div className="segmented" role="group" aria-label="简繁">
          <button type="button" className={settings.conversion === "none" ? "active" : ""}
            onClick={() => onUpdate({ conversion: "none" })}>原样</button>
          <button type="button" className={settings.conversion === "simp" ? "active" : ""}
            onClick={() => onUpdate({ conversion: "simp" })}>简体</button>
          <button type="button" className={settings.conversion === "trad" ? "active" : ""}
            onClick={() => onUpdate({ conversion: "trad" })}>繁体</button>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">对齐</label>
        <div className="segmented" role="group" aria-label="对齐">
          <button type="button" className={settings.textAlign === "left" ? "active" : ""}
            onClick={() => onUpdate({ textAlign: "left" })}>左对齐</button>
          <button type="button" className={settings.textAlign === "justify" ? "active" : ""}
            onClick={() => onUpdate({ textAlign: "justify" })}>两端</button>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-label">页边距</label>
        <div className="segmented" role="group" aria-label="页边距">
          <button type="button" className={settings.pageMargin === "narrow" ? "active" : ""}
            onClick={() => onUpdate({ pageMargin: "narrow" })}>窄</button>
          <button type="button" className={settings.pageMargin === "medium" ? "active" : ""}
            onClick={() => onUpdate({ pageMargin: "medium" })}>中</button>
          <button type="button" className={settings.pageMargin === "wide" ? "active" : ""}
            onClick={() => onUpdate({ pageMargin: "wide" })}>宽</button>
        </div>
      </div>
    </div>
  );
}
