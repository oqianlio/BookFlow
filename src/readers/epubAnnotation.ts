import type { Rendition } from "epubjs";

export interface StoredAnnotation {
  location: string;
  text: string;
  color: string;
  id: number;
}

export function applyAnnotations(
  rendition: Rendition,
  annotations: StoredAnnotation[],
  onRemove?: (id: number) => void,
) {
  for (const a of annotations) {
    rendition.annotations.highlight(
      a.location,
      {},
      (event: any, cfi: string, _contents: any) => {
        if (onRemove && event.target) {
          onRemove(a.id);
          rendition.annotations.remove(cfi, "highlight");
        }
      },
      a.color,
      { text: a.text },
    );
  }
}

export function installSelectionHandler(
  rendition: Rendition,
  onHighlight: (text: string, cfiRange: string) => void,
) {
  rendition.on("selected", (cfiRange: string, contents: any) => {
    const text = contents.window.getSelection?.()?.toString?.() ?? "";
    if (text.trim()) onHighlight(text.trim(), cfiRange);
  });
}

export function removeHighlight(rendition: Rendition, cfi: string) {
  rendition.annotations.remove(cfi, "highlight");
}

/**
 * 清洗 EPUB 章节 XHTML 文档（best-effort 防御）：
 * 移除 script / iframe / object / embed 元素，以及全部 on* 事件属性和 javascript: 伪协议链接。
 * epub.js 章节 iframe 为 sandbox（无 allow-scripts），本函数作为纵深防御在章节加载时执行。
 */
export function sanitizeXhtml(doc: Document): void {
  doc.querySelectorAll("script, iframe, object, embed").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (
        (name === "href" || name === "src") &&
        attr.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
}
