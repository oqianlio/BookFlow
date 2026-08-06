import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PdfReader from "./PdfReader";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 3 }) }),
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs", () => ({}));
vi.mock("../services/api", () => ({
  getProgress: vi.fn().mockResolvedValue(null),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

describe("PdfReader", () => {
  it("renders toolbar with page nav", () => {
    render(<PdfReader path="/b.pdf" bookId={1} />);
    expect(screen.getByText(/上一页/)).toBeInTheDocument();
    expect(screen.getByText(/下一页/)).toBeInTheDocument();
  });
});
