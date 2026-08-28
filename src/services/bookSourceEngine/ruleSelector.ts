/**
 * 选择器模块
 * 负责处理 CSS/XPath/JSON 选择器的解析和节点查询
 */

// No imports needed - this module is self-contained

// ============ 选择器工具 ============

export function normalizeSelector(sel: string): string {
  let s = sel.trim();
  if (s.startsWith("id.")) return `#${s.slice(3)}`;
  if (s.startsWith("class.")) {
    // class.a b c → .a.b.c（多类合并）；正常 .a b 后代选择器不受影响
    return `.${s.slice(6).trim().split(/\s+/).join(".")}`;
  }
  return s;
}

export function selectNodes(doc: Document, selector: string): Element[] {
  if (!selector.trim()) return [];
  try {
    return Array.from(doc.querySelectorAll(normalizeSelector(selector)));
  } catch {
    const hit = queryIndexed(selector, doc);
    return hit ? [hit] : [];
  }
}

/** 安全选择：常规 querySelectorAll（含 legado 简写规范化），失败则回退 queryIndexed 单节点 */
export function selectNodesSafe(selector: string, scope: Document | Element): Element[] {
  try {
    return Array.from(scope.querySelectorAll(normalizeSelector(selector)));
  } catch {
    const hit = queryIndexed(selector, scope);
    return hit ? [hit] : [];
  }
}

// ============ 节点值提取 ============

export function nodeValue(node: Element, attr?: string): string {
  const a = attr ?? "text";
  switch (a) {
    case "text":
      return (node.textContent ?? "").trim();
    case "ownText": {
      let out = "";
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.textContent ?? "";
      }
      return out.trim();
    }
    case "all":
      return (node.textContent ?? "").trim();
    case "textNodes": {
      // legado 的 @textNodes：收集所有后代文本节点并拼接（常用于正文提取）
      let out = "";
      const walker = (n: Node) => {
        for (const child of n.childNodes) {
          if (child.nodeType === 3) {
            out += (child.textContent ?? "") + "\n";
          } else {
            walker(child);
          }
        }
      };
      walker(node);
      return out.trim();
    }
    case "html":
      return (node as HTMLElement).innerHTML?.trim() ?? "";
    case "href":
      return node.getAttribute("href") ?? "";
    case "src":
      return node.getAttribute("src") ?? "";
    default:
      return node.getAttribute(a) ?? (node.textContent ?? "").trim();
  }
}

// ============ 索引查询 ============

export function resolveTagIndex(selector: string, scope: Document | Element): Element | null {
  const m = selector.match(/^tag\.([a-zA-Z][\w-]*)\.(\d+)$/);
  if (!m) return null;
  const tag = m[1];
  const index = parseInt(m[2], 10);
  const nodes = scope.querySelectorAll(tag);
  return nodes[index] ?? null;
}

/**
 * 在 scope 内查找选择器命中节点；支持 legado `.class.N` 语法（取第 N 个匹配）。
 * 先尝试常规 querySelector；失败（非法选择器）或带数字后缀时，按 base 选择器 + index 取。
 */
export function queryIndexed(selector: string, scope: Document | Element): Element | null {
  const sel = selector.trim();
  // legado text.xxx：元素自身文本（直接文本子节点）包含 xxx（锚点定位，如 text.章节目录 / text.下一章）。
  // 用 ownText（不含后代）而非 textContent：祖先元素 textContent 含全部后代文本，会先误匹配；
  // contains 而非等于：真实页面文本常带符号后缀，如"查看全部章节 >>"
  if (sel.startsWith("text.")) {
    const target = sel.slice(5).trim();
    if (!target) return null;
    const all = scope.querySelectorAll("*");
    for (const el of all) {
      let own = "";
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) own += n.textContent ?? "";
      }
      if (own.includes(target)) return el;
    }
    return null;
  }
  // legado `!` 索引：`tr!0`（第 0 个）/`tag.tr!0`（tag 前缀剥除）/`xxx!last`
  const bang = sel.match(/^(?:(?:tag\.)?)(.+?)!(\d+|last)$/);
  if (bang) {
    try {
      const nodes = scope.querySelectorAll(normalizeSelector(bang[1]));
      const idx = bang[2] === "last" ? nodes.length - 1 : parseInt(bang[2], 10);
      return nodes[idx] ?? null;
    } catch {
      return null;
    }
  }
  // legado 括号索引：`class.recommend[-1]`（倒数第 1 个）/`.item[0]`（第 0 个）
  const br = sel.match(/^(?:(?:tag\.)?)(.+?)\[(-?\d+)\]$/);
  if (br) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = scope.querySelectorAll(normalizeSelector(br[1]));
    } catch {
      return null;
    }
    const i = parseInt(br[2], 10);
    return nodes[i < 0 ? nodes.length + i : i] ?? null;
  }
  try {
    const hit = scope.querySelector(normalizeSelector(sel));
    if (hit) return hit;
    // 合法但无匹配（如 "tag.span" 视为 tag 元素）→ 继续走 tag.X / 索引回退
  } catch {
    // 非法选择器（如 .author.0）→ 尝试拆分 .数字 后缀
  }
  // legado tag.X（无索引）→ 取第一个匹配标签
  const tm = sel.match(/^tag\.([a-zA-Z][\w-]*)$/);
  if (tm) {
    try { return scope.querySelector(tm[1]) ?? null; } catch { return null; }
  }
  const m = sel.match(/^(.+?)\.(\d+)$/);
  if (!m) return null;
  const base = m[1];
  const index = parseInt(m[2], 10);
  let nodes: NodeListOf<Element>;
  try {
    nodes = scope.querySelectorAll(normalizeSelector(base));
  } catch {
    return null;
  }
  return nodes[index] ?? null;
}
