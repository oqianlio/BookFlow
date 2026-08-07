import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TxtReader from "./TxtReader";

vi.mock("../services/api", () => ({
  readFileContent: vi.fn().mockResolvedValue(Array.from({ length: 80 }, (_, i) => `行${i}`).join("\n")),
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

describe("TxtReader", () => {
  it("jumps to a page on reader-jump event", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "1" }));
    expect(await screen.findByText(/2 \/ 2/)).toBeInTheDocument();
  });

  it("jumps from a search line offset (line:N) to the right page", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    // 第 60 行落在第 2 页（每页 40 行）
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "line:60" }));
    expect(await screen.findByText(/2 \/ 2/)).toBeInTheDocument();
  });

  it("publishes current page as __readerLocation", async () => {
    render(<TxtReader path="/b.txt" bookId={1} />);
    await screen.findByText(/1 \/ 2/);
    expect((window as any).__readerLocation).toBe("0");
  });
});
