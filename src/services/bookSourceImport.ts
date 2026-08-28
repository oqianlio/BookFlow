import { addBookSource, httpGet, readFileContent, HTTP_TIMEOUT_IMPORT } from "./api";
import type { BookSource } from "./bookSourceEngine";

function tryParseBookSourceList(s: string): BookSource[] | null {
  try {
    const obj = JSON.parse(s.trim());
    if (Array.isArray(obj)) {
      const valid = obj.filter((x): x is BookSource =>
        x && typeof x === "object" && x.bookSourceUrl && x.bookSourceName
      );
      return valid.length > 0 ? valid : null;
    }
    if (obj && typeof obj === "object" && obj.bookSourceUrl && obj.bookSourceName) {
      return [obj as BookSource];
    }
    return null;
  } catch {
    return null;
  }
}

export function parseBookSourceCollection(text: string): BookSource[] {
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

export function extractBookSourceFromText(text: string): BookSource | undefined {
  const list = parseBookSourceCollection(text);
  return list[0];
}

export async function importBookSourceFromUrl(url: string): Promise<{ bookSources: BookSource[] }> {
  if (!url.trim()) throw new Error("请输入书源网址");
  const text = await httpGet({ url: url.trim(), timeoutMs: HTTP_TIMEOUT_IMPORT });
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}

export async function importBookSourceFromFile(path: string): Promise<{ bookSources: BookSource[] }> {
  const text = await readFileContent(path);
  const bookSources = parseBookSourceCollection(text);
  return { bookSources };
}

export function sourceUsesJs(bookSource: BookSource): boolean {
  const s = JSON.stringify(bookSource);
  return s.includes("@js:") || s.includes("<js>");
}

export async function commitBookSource(bookSource: BookSource): Promise<number> {
  return addBookSource(bookSource.bookSourceName, bookSource.bookSourceUrl, JSON.stringify(bookSource));
}
