// 会话级章节缓存：App 运行期间保留最近读过的章节内容。
// 重新打开刚看过的书/换源返回时零加载直接显示（持久缓存负责长期/离线场景）。
export interface SessionChapter {
  content: string;
  images: string[];
  isManga: boolean;
  nextUrl: string;
}

const cache = new Map<string, SessionChapter>();
const LIMIT = 30; // 最多保留 30 个章节，超出淘汰最旧

function key(sourceId: number, bookUrl: string, chapterUrl: string): string {
  return `${sourceId}:${bookUrl}:${chapterUrl}`;
}

export function getSessionChapter(sourceId: number, bookUrl: string, chapterUrl: string): SessionChapter | undefined {
  return cache.get(key(sourceId, bookUrl, chapterUrl));
}

export function setSessionChapter(sourceId: number, bookUrl: string, chapterUrl: string, entry: SessionChapter): void {
  const k = key(sourceId, bookUrl, chapterUrl);
  cache.set(k, entry);
  if (cache.size > LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function clearSessionChapterCache(): void {
  cache.clear();
}
