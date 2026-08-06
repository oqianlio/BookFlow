import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme, applyFontSize, getFontSize } from "./components/theme";

void initTheme();
applyFontSize(getFontSize());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
