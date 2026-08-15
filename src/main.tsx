import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme, applyFontSize, getFontSize } from "./components/theme";
import { startEyeCareWatcher } from "./services/eyeCareWatcher";
import { logFrontend } from "./services/api";

void initTheme();
applyFontSize(getFontSize());
// 护眼定时：夜间窗口自动切暗色（60s 检查一次）
startEyeCareWatcher(60000);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

if (window.__TAURI_INTERNALS__) {
  window.addEventListener("error", (e) => {
    void logFrontend("error", e.message + " @ " + (e.filename ?? "") + ":" + (e.lineno ?? ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    void logFrontend("error", "unhandled rejection: " + String(e.reason));
  });
  const fwd = (level: string) => (...args: unknown[]) => {
    void logFrontend(level, args.map((a) => String(a)).join(" "));
  };
  console.log = fwd("log");
  console.warn = fwd("warn");
  console.error = fwd("error");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
