/**
 * JSON Path 处理（legado JsonPath 子集）
 * 支持 [n] 索引、[*] 通配（返回匹配数组）、[a:b] 范围切片、[?(条件)] 过滤、
 * `..` 递归下降、数组上取字段。自 ruleExtractor 拆出（纯函数，无外部依赖）。
 */

export function jsonGet(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  let p = path.trim();
  if (p.startsWith("$..")) p = p.slice(1); // 保留递归标记 `..`
  else if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);
  if (!p) return obj;
  return jsonWalk(obj, jsonTokens(p));
}

// 路径分词：[] 括号内容整体为一个 token（兼容 ?(...) 过滤里的 .），其余按 . 分隔；
// `..` 递归下降标记（legado JsonPath，如 $..books[*] 任意深度找 books）
function jsonTokens(p: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "[") {
      const end = p.indexOf("]", i);
      if (end === -1) break;
      tokens.push(p.slice(i + 1, end));
      i = end + 1;
    } else if (ch === ".") {
      // `..` → 递归标记；单 `.` 跳过
      if (p[i + 1] === ".") {
        tokens.push("..");
        i += 2;
      } else {
        i++;
      }
    } else {
      let end = p.length;
      const dot = p.indexOf(".", i);
      const br = p.indexOf("[", i);
      if (dot !== -1 && dot < end) end = dot;
      if (br !== -1 && br < end) end = br;
      if (end > i) tokens.push(p.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

/** 任意深度递归查找 key（legado `..` 语义）：遍历对象与数组的所有层级 */
function jsonFindDeep(cur: unknown, key: string, rest: string[]): unknown {
  if (cur == null) return undefined;
  if (Array.isArray(cur)) {
    const out: unknown[] = [];
    for (const it of cur) {
      const v = jsonFindDeep(it, key, rest);
      if (v != null) out.push(...(Array.isArray(v) ? v : [v]));
    }
    return out.length ? out : undefined;
  }
  if (typeof cur !== "object") return undefined;
  const obj = cur as Record<string, unknown>;
  if (key in obj) {
    const v = jsonWalk(obj[key], rest);
    if (v != null) return v;
  }
  // 递归子对象
  const out: unknown[] = [];
  for (const k of Object.keys(obj)) {
    if (k === key) continue;
    const v = jsonFindDeep(obj[k], key, rest);
    if (v != null) out.push(...(Array.isArray(v) ? v : [v]));
  }
  return out.length ? out : undefined;
}

// legado JsonPath 子集：支持 [n] 索引、[*] 通配（返回匹配数组）、[a:b] 范围切片、[?(条件)] 过滤、数组上取字段
function jsonWalk(cur: unknown, tokens: string[]): unknown {
  if (tokens.length === 0 || cur == null) return cur;
  const tok = tokens[0];
  const rest = tokens.slice(1);
  // `..` 递归下降：任意深度找下一个 token 的 key
  if (tok === "..") {
    if (rest.length === 0) return cur;
    return jsonFindDeep(cur, rest[0], rest.slice(1));
  }
  if (Array.isArray(cur)) {
    if (/^\d+$/.test(tok)) return jsonWalk(cur[Number(tok)], rest);
    if (tok === "*") {
      const out = cur.map((it) => jsonWalk(it, rest)).filter((v) => v != null);
      return out.length ? out : undefined;
    }
    if (/^\d+:\d+$/.test(tok)) {
      const [a, b] = tok.split(":").map(Number);
      const out = cur.slice(a, b).map((it) => jsonWalk(it, rest)).filter((v) => v != null);
      return out.length ? out : undefined;
    }
    const fm = tok.match(/^\?\((.*)\)$/);
    if (fm) {
      const out = cur.filter((it) => jsonFilter(it, fm[1]));
      return jsonWalk(out, rest);
    }
    // 数组上取字段：逐项映射
    const out = cur.map((it) => jsonWalk(it, tokens)).filter((v) => v != null);
    return out.length ? out : undefined;
  }
  if (tok === "*") return jsonWalk(cur, rest);
  if (/^\d+:\d+$/.test(tok)) return undefined;
  const fm = tok.match(/^\?\((.*)\)$/);
  if (fm) return cur;
  return jsonWalk((cur as Record<string, unknown>)[tok], rest);
}

// JSONPath 过滤条件求值：支持 ==/!=/>/</>=/<=、&&/||、@. 前缀、存在性
function jsonFilter(item: unknown, expr: string): boolean {
  return expr.split("||").some((o) =>
    o.split("&&").every((a) => jsonFilterAtom(item, a.trim())),
  );
}

function jsonFilterAtom(item: unknown, atom: string): boolean {
  if (!atom) return true;
  const m = atom.match(/^(?:@\.)?([\w-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    const key = atom.replace(/^@\./, "").trim();
    return key ? !!(item as Record<string, unknown>)?.[key] : false;
  }
  const val = (item as Record<string, unknown>)?.[m[1]];
  const raw = m[3].trim();
  let target: unknown = raw;
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    target = raw.slice(1, -1);
  } else if (raw === "true") {
    target = true;
  } else if (raw === "false") {
    target = false;
  } else if (!Number.isNaN(Number(raw)) && raw.trim() !== "") {
    target = Number(raw);
  }
  switch (m[2]) {
    case "==": return val == target;
    case "!=": return val != target;
    case ">": return Number(val) > Number(target);
    case "<": return Number(val) < Number(target);
    case ">=": return Number(val) >= Number(target);
    case "<=": return Number(val) <= Number(target);
  }
  return false;
}
