import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme, applyFontSize, getFontSize } from "./components/theme";
import { logFrontend } from "./services/api";

void initTheme();
applyFontSize(getFontSize());

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
  console.error = (...args: unknown[]) => {
    void logFrontend("error", args.map((a) => String(a)).join(" "));
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
