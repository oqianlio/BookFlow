import { addBookSource, httpGet, readFileContent } from "./api";

function tryParseBookSource(s: string): any {
  try {
    const obj = JSON.parse(s.trim());
    const cand = Array.isArray(obj) ? obj : [obj];
    return cand.find((x) => x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName) ?? null;
  } catch {
    return null;
  }
}

export function validateBookSource(bookSource: any): void {
  const json = JSON.stringify(bookSource ?? {});
  if (json.includes("@js:") || json.includes("<js>")) {
    throw new Error("此书源依赖 @js: 脚本，当前版本不支持，请改用纯 CSS/正则书源");
  }
}

export function extractBookSourceFromText(text: string): any {
  const trimmed = text.trim();
  const direct = tryParseBookSource(trimmed);
  if (direct) {
    validateBookSource(direct);
    return direct;
  }

  const pre = /<(?:pre|textarea)[^>]*>([\s\S]*?)<\/(?:pre|textarea)>/i.exec(text);
  if (pre) {
    const hit = tryParseBookSource(pre[1]);
    if (hit) {
      validateBookSource(hit);
      return hit;
    }
  }

  const inline = /\{[^{}]*"bookSourceUrl"\s*:\s*"[^"]*"[^{}]*\}/.exec(text);
  if (inline) {
    const hit = tryParseBookSource(inline[0]);
    if (hit) {
      validateBookSource(hit);
      return hit;
    }
  }

  throw new Error("未能从内容中解析出书源，请确认是书源 JSON 文件或包含书源信息的网页");
}

export async function importBookSourceFromUrl(url: string): Promise<{ name: string; url: string; bookSource: any }> {
  if (!url.trim()) throw new Error("请输入书源网址");
  const text = await httpGet(url.trim(), undefined, 20000);
  const bookSource = extractBookSourceFromText(text);
  return { name: bookSource.bookSourceName, url: bookSource.bookSourceUrl, bookSource };
}

export async function importBookSourceFromFile(path: string): Promise<{ name: string; url: string; bookSource: any }> {
  const text = await readFileContent(path);
  const bookSource = extractBookSourceFromText(text);
  return { name: bookSource.bookSourceName, url: bookSource.bookSourceUrl, bookSource };
}

export async function commitBookSource(bookSource: any): Promise<number> {
  return addBookSource(bookSource.bookSourceName, bookSource.bookSourceUrl, JSON.stringify(bookSource));
}
