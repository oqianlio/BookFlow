import { readFileContent } from "./api";

// 会话级本地书文本缓存：重开本地书（TXT/MD）不再重复读盘。
// 文件在会话内通常不变，缓存到 App 运行结束；上限 5 个文件，超出淘汰最旧。
const cache = new Map<string, string>();
const LIMIT = 5;

export async function readLocalText(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  const text = await readFileContent(path);
  cache.set(path, text);
  if (cache.size > LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return text;
}

export function clearLocalTextCache(): void {
  cache.clear();
}
