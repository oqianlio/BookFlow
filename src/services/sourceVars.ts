const store = new Map<string, Map<string, string>>();

export function getSourceVars(sourceKey: string): Map<string, string> {
  let vars = store.get(sourceKey);
  if (!vars) {
    vars = new Map();
    store.set(sourceKey, vars);
  }
  return vars;
}

export function resetSourceVars(sourceKey: string): void {
  store.delete(sourceKey);
}
