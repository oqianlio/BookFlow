import { addBookSource, httpGet, readFileContent } from "./api";

function tryParseBookSourceList(s: string): any[] | null {
  try {
    const obj = JSON.parse(s.trim());
    if (Array.isArray(obj)) {
      const valid = obj.filter((x) => x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName);
      return valid.length > 0 ? valid : null;
    }
    if (obj && typeof obj === "object" && obj.bookSourceUrl && obj.bookSourceName) {
      return [obj];
    }
    return null;
  } catch {
    return null;
  }
}

export function parseBookSourceCollection(text: string): any[] {
  const trimmed = text.trim();
  const direct = tryParseBookSourceList(trimmed);
  if (direct) return direct;

  const pre = /<(?:pre|textarea)[^>]*>([\s\S]*?)<\/(?:pre|textarea)>/i.exec(text);
  if (pre) {
    const hit = tryParseBookSourceList(pre[1]);
    if (hit) return hit;
  }

  const inline = /\{[^{}]*"bookSourceUrl"\s*:\s*"[^"]*"[^{}]*\}/.exec(text);
  if (inline) {
    const hit = tryParseBookSourceList(inline[0]);
    if (hit) return hit;
  }

  throw new Error("未能从内容中解析出书源，请确认是书源 JSON 文件或包含书源信息的网页");
}

export function extractBookSourceFromText(text: string): any {
  const list = parseBookSourceCollection(text);
  return list[0];
}

export async function importBookSourceFromUrl(url: string): Promise<{ bookSources: any[] }> {
  if (!url.trim()) throw new Error("请输入书源网址");
  const text = await httpGet(url.trim(), undefined, 20000);
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}

export async function importBookSourceFromFile(path: string): Promise<{ bookSources: any[] }> {
  const text = await readFileContent(path);
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}

export function sourceUsesJs(bookSource: any): boolean {
  const s = JSON.stringify(bookSource);
  return s.includes("@js:") || s.includes("<js>");
}

export async function commitBookSource(bookSource: any): Promise<number> {
  return addBookSource(bookSource.bookSourceName, bookSource.bookSourceUrl, JSON.stringify(bookSource));
}
