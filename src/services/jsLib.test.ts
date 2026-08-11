import { describe, it, expect, beforeEach } from "vitest";
import { loadJsLib, getJsLib, resetJsLib } from "./jsLib";

describe("jsLib session cache", () => {
  beforeEach(() => { resetJsLib("a.com"); resetJsLib("b.com"); });

  it("caches inline jsLib and returns true", () => {
    expect(loadJsLib("a.com", "function GEN_EXPLORE(){ return 'x::/x'; }")).toBe(true);
    expect(getJsLib("a.com")).toContain("function GEN_EXPLORE");
  });

  it("skips empty jsLib", () => {
    expect(loadJsLib("a.com", "")).toBe(false);
    expect(loadJsLib("a.com", undefined)).toBe(false);
    expect(getJsLib("a.com")).toBe("");
  });

  it("skips remote URL jsLib", () => {
    expect(loadJsLib("a.com", "https://example.com/lib.js")).toBe(false);
    expect(loadJsLib("a.com", "http://example.com/lib.js")).toBe(false);
    expect(getJsLib("a.com")).toBe("");
  });

  it("isolates by sourceKey", () => {
    loadJsLib("a.com", "function F(){ return 1; }");
    expect(getJsLib("b.com")).toBe("");
  });
});
