const store = new Map<string, string>();
const REMOTE_URL_RE = /^https?:\/\//i;

export function loadJsLib(sourceKey: string, jsLib?: string): boolean {
  const code = jsLib?.trim() ?? "";
  if (!code || REMOTE_URL_RE.test(code)) return false;
  store.set(sourceKey, code);
  return true;
}

export function getJsLib(sourceKey: string): string {
  return store.get(sourceKey) ?? "";
}

export function resetJsLib(sourceKey: string): void {
  store.delete(sourceKey);
}
