import { useEffect } from "react";

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
