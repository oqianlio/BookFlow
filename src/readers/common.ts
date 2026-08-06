import { useEffect, useRef } from "react";

export function useSaveOnLocationChange(
  bookId: number,
  location: string | null,
  percent: number,
  save: (loc: string, pct: number) => Promise<void>,
) {
  useEffect(() => {
    if (location == null) return;
    const t = setTimeout(() => { void save(location, percent); }, 800);
    return () => clearTimeout(t);
  }, [location, percent, save, bookId]);
}

export function useJumpTarget(handler: (loc: string) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      const loc = detail || ((window as any).__jumpTo as string | undefined);
      if (loc) handlerRef.current(loc);
    };
    window.addEventListener("reader-jump", onJump);
    return () => window.removeEventListener("reader-jump", onJump);
  }, []);
}
