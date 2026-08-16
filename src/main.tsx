import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme, applyFontSize, getFontSize } from "./components/theme";
import { startEyeCareWatcher } from "./services/eyeCareWatcher";
import { injectFontFaces } from "./services/fontFiles";
import { logFrontend } from "./services/api";

void initTheme();
applyFontSize(getFontSize());
// 护眼定时：夜间窗口自动切暗色（60s 检查一次）
startEyeCareWatcher(60000);
// 已导入字体注册为 @font-face
void injectFontFaces();

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

if (window.__TAURI_INTERNALS__) {
  // 日志上报失败必须静默：避免 rejection 再触发 unhandledrejection 造成无限循环
  const safeLog = (level: string, message: string) => {
    logFrontend(level, message).catch(() => {});
  };
  window.addEventListener("error", (e) => {
    safeLog("error", e.message + " @ " + (e.filename ?? "") + ":" + (e.lineno ?? ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    safeLog("error", "unhandled rejection: " + String(e.reason));
  });
  const fwd = (level: string) => (...args: unknown[]) => {
    safeLog(level, args.map((a) => String(a)).join(" "));
  };
  console.log = fwd("log");
  console.warn = fwd("warn");
  console.error = fwd("error");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
