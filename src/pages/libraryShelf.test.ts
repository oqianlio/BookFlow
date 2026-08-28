// libraryShelf 纯逻辑特征化测试（拆分自 LibraryPage，行为锁定）
import { describe, it, expect } from "vitest";
import {
  sortShelfItems, itemMember, memberKey, filterByGroup, filterByText, collageOf, loadSort,
} from "./libraryShelf";
import type { ShelfItem } from "../components/BookCard";
import type { Book, ShelfSourceBook } from "../services/api";

const local = (id: number, title: string, over: Partial<Book> = {}): ShelfItem =>
  ({ kind: "local", book: { id, title, last_opened_at: 0, added_at: id, sort_order: null, ...over } as Book });
const source = (id: number, title: string, over: Partial<ShelfSourceBook> = {}): ShelfItem =>
  ({ kind: "source", sb: { id, title, author: null, source_name: null, last_opened_at: 0, added_at: id, sort_order: null, ...over } as ShelfSourceBook });

const titles = (xs: ShelfItem[]) => xs.map((x) => (x.kind === "local" ? x.book.title : x.sb.title));

describe("sortShelfItems", () => {
  // 标题用 ASCII，避免 zh locale 拼音/笔画排序歧义
  const items = [local(1, "b", { last_opened_at: 30 }), source(2, "a"), local(3, "c", { last_opened_at: 10 })];

  it("mode 2 sorts by title ascending; desc flips", () => {
    expect(titles(sortShelfItems(items, 2, false))).toEqual(["a", "b", "c"]);
    expect(titles(sortShelfItems(items, 2, true))).toEqual(["c", "b", "a"]);
  });

  it("mode 0 sorts by read time descending by default", () => {
    expect(titles(sortShelfItems(items, 0, true))).toEqual(["b", "c", "a"]);
  });

  it("mode 5 uses manual order and ignores desc; null sorts last", () => {
    const manual = [
      local(3, "丙", { sort_order: 2 }),
      local(1, "乙", { sort_order: 0 }),
      source(2, "甲"), // 无手动序 → 最后
    ];
    expect(titles(sortShelfItems(manual, 5, false))).toEqual(["乙", "丙", "甲"]);
    expect(titles(sortShelfItems(manual, 5, true))).toEqual(["乙", "丙", "甲"]);
  });

  it("is stable for equal keys (original order preserved)", () => {
    const eq = [local(1, "甲", { last_opened_at: 5 }), local(2, "乙", { last_opened_at: 5 })];
    expect(titles(sortShelfItems(eq, 0, true))).toEqual(["甲", "乙"]);
  });
});

describe("filterByGroup", () => {
  const groups = [{ id: 1, name: "科幻" } as never];
  const members = new Map<string, Set<number>>([["local:1", new Set([1])]]);
  const items = [local(1, "甲"), local(2, "乙")];

  it("all returns everything", () => {
    expect(filterByGroup(items, "all", groups, members)).toHaveLength(2);
  });
  it("default returns items in no group", () => {
    expect(titles(filterByGroup(items, "default", groups, members))).toEqual(["乙"]);
  });
  it("g:<id> returns group members", () => {
    expect(titles(filterByGroup(items, "g:1", groups, members))).toEqual(["甲"]);
  });
});

describe("filterByText", () => {
  const items = [
    local(1, "三体"),
    source(2, "诡秘之主", { author: "爱潜水的乌贼", source_name: "起点" }),
  ];

  it("matches title/author/source name case-insensitively", () => {
    expect(filterByText(items, "三体")).toHaveLength(1);
    expect(filterByText(items, "乌贼")).toHaveLength(1);
    expect(filterByText(items, "起点")).toHaveLength(1);
    expect(filterByText(items, "不存在")).toHaveLength(0);
  });
  it("empty/blank text returns all", () => {
    expect(filterByText(items, "  ")).toHaveLength(2);
  });
});

describe("collageOf", () => {
  it("returns only groups that have members, with their items", () => {
    const groups = [{ id: 1, name: "A" }, { id: 2, name: "B" }] as never[];
    const members = new Map<string, Set<number>>([["local:1", new Set([10])]]);
    const items = [local(10, "甲"), local(11, "乙")];
    const r = collageOf(groups, members, items);
    expect(r).toHaveLength(1);
    expect(r[0].group).toEqual({ id: 1, name: "A" });
    expect(titles(r[0].members)).toEqual(["甲"]);
  });
});

describe("helpers", () => {
  it("itemMember/memberKey key by kind and id", () => {
    expect(memberKey(itemMember(local(7, "x")))).toBe("local:7");
    expect(memberKey(itemMember(source(8, "y")))).toBe("source:8");
  });
  it("loadSort falls back to default on invalid JSON", () => {
    localStorage.setItem("library.sort", "{broken");
    expect(loadSort()).toEqual({ mode: 0, desc: true });
    localStorage.setItem("library.sort", JSON.stringify({ mode: 3, desc: false }));
    expect(loadSort()).toEqual({ mode: 3, desc: false });
    localStorage.removeItem("library.sort");
  });
});
