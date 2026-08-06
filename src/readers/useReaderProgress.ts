import { useCallback, useEffect, useRef, useState } from "react";
import { getProgress, saveProgress } from "../services/api";

export function useReaderProgress(bookId: number, saveIntervalMs = 3000) {
  const [location, setLocation] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<{ loc: string; pct: number } | null>(null);
  const latest = useRef<{ loc: string; pct: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await getProgress(bookId);
        if (!cancelled && saved) {
          setLocation(saved[0]);
          setPercent(saved[1]);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const save = useCallback(async (loc: string, pct: number) => {
    latest.current = { loc, pct };
    await saveProgress(bookId, loc, pct);
  }, [bookId]);

  const flush = useCallback(async () => {
    if (pending.current) {
      await saveProgress(bookId, pending.current.loc, pending.current.pct);
      pending.current = null;
    }
  }, [bookId]);

  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, saveIntervalMs);
    const onUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush, saveIntervalMs]);

  const saveDebounced = useCallback((loc: string, pct: number) => {
    setLocation(loc);
    setPercent(pct);
    pending.current = { loc, pct };
  }, []);

  return { location, percent, loaded, save, saveDebounced };
}
