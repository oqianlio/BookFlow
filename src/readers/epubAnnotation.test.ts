import { describe, it, expect, vi } from "vitest";
import { installSelectionHandler, applyAnnotations, sanitizeXhtml } from "./epubAnnotation";

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

  it("sanitizeXhtml strips scripts, on* handlers and javascript: links", () => {
    document.body.innerHTML = `
      <div id="root" onclick="alert(1)">
        <script>window.__TAURI_INTERNALS__.invoke('x')</script>
        <a href="javascript:alert(1)">bad</a>
        <a href="https://example.com" data-x="ok" onclick="evil()">good</a>
        <iframe src="https://evil.com"></iframe>
      </div>`;
    sanitizeXhtml(document);
    const root = document.getElementById("root")!;
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.getAttribute("onclick")).toBeNull();
    const bad = root.querySelector("a[href='javascript:alert(1)']");
    expect(bad).toBeNull();
    const good = Array.from(root.querySelectorAll("a")).find((a) => a.textContent === "good")!;
    expect(good.getAttribute("href")).toBe("https://example.com");
    expect(good.getAttribute("onclick")).toBeNull();
    expect(good.getAttribute("data-x")).toBe("ok");
  });
});
