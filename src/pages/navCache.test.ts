import { describe, it, expect, beforeEach } from "vitest";
import {
  saveExploreSnapshot, takeExploreSnapshot,
  saveDiscoverSnapshot, takeDiscoverSnapshot,
  restoreExploreSnapshot, resetNavCache,
} from "./navCache";

describe("navCache", () => {
  beforeEach(() => resetNavCache());

  it("saves and takes explore snapshot per sourceId", () => {
    const snap = { active: { title: "玄幻", url: "/sort/1.html" }, books: [], page: 2 };
    saveExploreSnapshot(7, snap);
    expect(takeExploreSnapshot(7)).toEqual(snap);
    expect(takeExploreSnapshot(8)).toBeUndefined();
  });

  it("saves and takes discover snapshot", () => {
    expect(takeDiscoverSnapshot()).toBeNull();
    saveDiscoverSnapshot({ query: "三体", hits: [] });
    expect(takeDiscoverSnapshot()).toEqual({ query: "三体", hits: [] });
  });

  it("resetNavCache clears all snapshots", () => {
    saveExploreSnapshot(1, { active: null, books: [], page: 1 });
    saveDiscoverSnapshot({ query: "q", hits: [] });
    resetNavCache();
    expect(takeExploreSnapshot(1)).toBeUndefined();
    expect(takeDiscoverSnapshot()).toBeNull();
  });
});

describe("restoreExploreSnapshot", () => {
  const cats = [{ title: "玄幻", url: "/sort/1.html" }, { title: "都市", url: "/sort/2.html" }];

  it("restores snapshot whose active category still exists", () => {
    const snap = { active: { title: "玄幻", url: "/sort/1.html" }, books: [], page: 1 };
    expect(restoreExploreSnapshot(snap, cats)).toEqual(snap);
  });

  it("returns null when active category no longer exists (rule changed)", () => {
    const snap = { active: { title: "科幻", url: "/sort/9.html" }, books: [], page: 1 };
    expect(restoreExploreSnapshot(snap, cats)).toBeNull();
  });

  it("restores snapshot with no active category (never clicked)", () => {
    const snap = { active: null, books: [], page: 1 };
    expect(restoreExploreSnapshot(snap, cats)).toEqual(snap);
  });

  it("returns null for undefined snapshot", () => {
    expect(restoreExploreSnapshot(undefined, cats)).toBeNull();
  });
});
