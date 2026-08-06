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
