import { describe, it, expect } from "vitest";
import { isInNightWindow } from "./eyeCare";

const d = (hh: number, mm: number) => new Date(2024, 0, 1, hh, mm);

describe("isInNightWindow", () => {
  it("normal window (22:00-06:00)", () => {
    expect(isInNightWindow(d(22, 30), "22:00", "06:00")).toBe(true);
    expect(isInNightWindow(d(5, 59), "22:00", "06:00")).toBe(true);
    expect(isInNightWindow(d(12, 0), "22:00", "06:00")).toBe(false);
    expect(isInNightWindow(d(6, 0), "22:00", "06:00")).toBe(false); // 结束边界不含
  });

  it("cross-midnight window", () => {
    expect(isInNightWindow(d(23, 0), "22:00", "06:00")).toBe(true);
    expect(isInNightWindow(d(1, 0), "22:00", "06:00")).toBe(true);
    expect(isInNightWindow(d(0, 30), "22:00", "06:00")).toBe(true);
  });

  it("same start and end means disabled", () => {
    expect(isInNightWindow(d(12, 0), "12:00", "12:00")).toBe(false);
  });

  it("day-only window (08:00-20:00)", () => {
    expect(isInNightWindow(d(9, 0), "08:00", "20:00")).toBe(true);
    expect(isInNightWindow(d(21, 0), "08:00", "20:00")).toBe(false);
  });
});
