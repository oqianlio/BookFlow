import { describe, it, expect, vi } from "vitest";
import { installSelectionHandler, applyAnnotations } from "./epubAnnotation";

function fakeRendition() {
  const annotations = { add: vi.fn(), remove: vi.fn(), highlight: vi.fn() };
  return {
    annotations,
    on: vi.fn(),
    getContents: vi.fn(() => []),
  };
}

describe("epubAnnotation", () => {
  it("applies stored annotations as highlights", () => {
    const r = fakeRendition();
    const anns = [{ location: "cfiA", text: "x", color: "yellow" }] as any;
    applyAnnotations(r as any, anns);
    expect(r.annotations.highlight).toHaveBeenCalledWith("cfiA", {}, expect.any(Function), "yellow", { text: "x" });
  });

  it("installs mouseup selection handler", () => {
    const r = fakeRendition();
    installSelectionHandler(r as any, () => {});
    expect(r.on).toHaveBeenCalledWith("selected", expect.any(Function));
  });
});
