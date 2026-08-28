/**
 * 内容净化模块
 * 负责清理 HTML 内容，移除广告、脚本等无关元素
 */

const REMOVE_SELECTORS = [
  "script", "style", "ins", "iframe", "noscript", "button", "footer",
  ".ad", ".ads", ".advert", "#ad",
];

/**
 * 清理 HTML 内容，移除广告、脚本等无关元素
 * @param html 原始 HTML 内容
 * @param replaceRules 替换规则（legado ##正则##替换 格式）
 * @returns 清理后的 HTML 内容
 */
export function purifyContent(html: string, replaceRules?: string[]): string {
  const doc = new DOMParser().parseFromString(`<div id="__purify__">${html}</div>`, "text/html");
  const root = doc.getElementById("__purify__")!;
  for (const sel of REMOVE_SELECTORS) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  let out = (root.innerHTML ?? "").trim();
  if (replaceRules) {
    for (const rule of replaceRules) {
      if (rule.startsWith("##")) {
        const parts = rule.slice(2).split("##");
        if (!parts[0]) continue;
        try {
          out = out.replace(new RegExp(parts[0], "g"), parts[1] ?? "");
        } catch {
          continue;
        }
      }
    }
  }
  return out;
}

/**
 * 检查 HTML 是否为图片章节（漫画模式）
 */
export function isImageChapter(html: string): boolean {
  return /<\s*img\b/i.test(html);
}

/**
 * 从 HTML 中提取所有图片 URL
 */
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (src) {
      try {
        urls.push(new URL(src, baseUrl).toString());
      } catch {
        urls.push(src);
      }
    }
  });
  return urls;
}
