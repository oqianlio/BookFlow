import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { listFontFiles, type FontFileRow } from "./api";

/**
 * 注入已导入字体为 @font-face（font-family = 显示名 name）。
 * 幂等：移除旧注入后重建。
 */
export async function injectFontFaces(): Promise<FontFileRow[]> {
  try {
    const dir = await appDataDir();
    const files = await listFontFiles();
    document.querySelectorAll("style[data-font-face]").forEach((el) => el.remove());
    if (files.length > 0) {
      const style = document.createElement("style");
      style.setAttribute("data-font-face", "");
      let css = "";
      for (const f of files) {
        const src = convertFileSrc(`${dir}fonts/${f.file}`);
        css += `@font-face{font-family:'${f.name}';src:url('${src}') format('truetype');font-display:swap;}\n`;
      }
      style.textContent = css;
      document.head.appendChild(style);
    }
    return files;
  } catch {
    return [];
  }
}
