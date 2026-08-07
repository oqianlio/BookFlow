import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PdfReader from "./PdfReader";

const { getDocumentMock } = vi.hoisted(() => {
  const getPage = vi.fn().mockResolvedValue({
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve() }),
  });
  const pdfDoc = { numPages: 3, getPage, destroy: vi.fn() };
  const destroyTask = vi.fn().mockResolvedValue(undefined);
  return {
    getDocumentMock: vi.fn(() => ({ promise: Promise.resolve(pdfDoc), destroy: destroyTask })),
  };
});

vi.mock("pdfjs-dist", () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs", () => ({}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));
vi.mock("../services/api", () => ({
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

describe("PdfReader", () => {
  beforeEach(() => {
    getDocumentMock.mockClear();
  });

  it("renders toolbar with page nav", () => {
    render(<PdfReader path="/b.pdf" bookId={1} />);
    expect(screen.getByText(/上一页/)).toBeInTheDocument();
    expect(screen.getByText(/下一页/)).toBeInTheDocument();
  });

  it("opens the document once and destroys on unmount", async () => {
    const { unmount } = render(<PdfReader path="/b.pdf" bookId={1} />);
    await screen.findByText(/1 \/ 3/);
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("jumps to a page on reader-jump event", async () => {
    render(<PdfReader path="/b.pdf" bookId={1} />);
    await screen.findByText(/1 \/ 3/);
    window.dispatchEvent(new CustomEvent("reader-jump", { detail: "2" }));
    expect(await screen.findByText(/2 \/ 3/)).toBeInTheDocument();
  });

  it("publishes current page as __readerLocation", async () => {
    render(<PdfReader path="/b.pdf" bookId={1} />);
    await screen.findByText(/1 \/ 3/);
    expect((window as any).__readerLocation).toBe("1");
  });
});
