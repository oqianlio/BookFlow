import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useJumpTarget } from "./common";

describe("useJumpTarget", () => {
  it("calls the handler when a reader-jump event is dispatched", () => {
    const handler = vi.fn();
    renderHook(() => useJumpTarget(handler));
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "cfi:jump" }));
    expect(handler).toHaveBeenCalledWith("cfi:jump");
  });

  it("falls back to window.__jumpTo when detail is empty", () => {
    const handler = vi.fn();
    renderHook(() => useJumpTarget(handler));
    (window as any).__jumpTo = "cfi:legacy";
    window.dispatchEvent(new CustomEvent("reader-jump"));
    expect(handler).toHaveBeenCalledWith("cfi:legacy");
  });

  it("ignores events with no location", () => {
    const handler = vi.fn();
    renderHook(() => useJumpTarget(handler));
    (window as any).__jumpTo = undefined;
    window.dispatchEvent(new CustomEvent("reader-jump"));
    expect(handler).not.toHaveBeenCalled();
  });
});
