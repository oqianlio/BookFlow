import { loadEyeCare, isInNightWindow } from "./eyeCare";
import { getTheme, setTheme } from "../components/theme";

/**
 * 护眼定时守护：夜间窗口内自动切 dark，窗口外恢复用户手动选择的模式。
 * 用户手动切换明暗模式时（SettingsPage setTheme），记录 manualMode 到 localStorage。
 * 返回停止函数。
 */
export function startEyeCareWatcher(intervalMs = 60000): () => void {
  const check = async () => {
    try {
      const ec = await loadEyeCare();
      if (!ec.enabled) return;
      const inWindow = isInNightWindow(new Date(), ec.start, ec.end);
      const cur = getTheme();
      const manual = (localStorage.getItem("reader.manualMode") ?? "light") as "light" | "dark";
      if (inWindow && cur.mode !== "dark") {
        await setTheme({ ...cur, mode: "dark" });
      } else if (!inWindow && cur.mode !== manual) {
        await setTheme({ ...cur, mode: manual });
      }
    } catch {
      // 静默：设置读取失败不打断阅读
    }
  };
  void check();
  const t = window.setInterval(() => void check(), intervalMs);
  return () => window.clearInterval(t);
}
