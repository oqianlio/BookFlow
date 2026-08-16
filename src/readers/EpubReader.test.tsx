import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import EpubReader from "./EpubReader";
import { DEFAULT_READING_SETTINGS } from "../services/readingSettings";

const themesMock = { fontSize: vi.fn(), default: vi.fn() };
const bookMock = {
  ready: Promise.resolve(),
  destroy: vi.fn(),
  spine: { hooks: { content: { register: vi.fn() } } },
  locations: {
    generate: vi.fn(() => Promise.resolve()),
    percentageFromCfi: vi.fn(() => 0.5),
  },
};
const renditionMock = {
  themes: themesMock,
  display: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  destroy: vi.fn(),
  currentLocation: vi.fn(() => ({ start: { cfi: "epubcfi(/6)" } })),
  book: bookMock,
};

vi.mock("epubjs", () => ({
  default: vi.fn(() => ({
    ...bookMock,
    renderTo: vi.fn(() => renditionMock),
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../services/api", () => ({
  addAnnotation: vi.fn().mockResolvedValue(1),
  deleteAnnotation: vi.fn().mockResolvedValue(undefined),
  listAnnotations: vi.fn().mockResolvedValue([]),
}));
vi.mock("../readers/useReaderProgress", () => ({
  useReaderProgress: () => ({ location: null, percent: 0, loaded: false, save: vi.fn(), saveDebounced: vi.fn() }),
}));
vi.mock("../readers/common", () => ({
  useJumpTarget: vi.fn(),
  useSaveOnLocationChange: vi.fn(),
}));
vi.mock("../readers/epubAnnotation", () => ({
  applyAnnotations: vi.fn(),
  installSelectionHandler: vi.fn(),
  removeHighlight: vi.fn(),
  sanitizeXhtml: vi.fn(),
}));

describe("EpubReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies reading settings into epubjs themes", async () => {
    render(<EpubReader path="C:/x.epub" bookId={1} settings={{ ...DEFAULT_READING_SETTINGS, fontSizePx: 20, lineHeight: 2.0, bgTheme: "night" }} />);
    await waitFor(() => expect(renditionMock.display).toHaveBeenCalled());
    expect(themesMock.fontSize).toHaveBeenCalledWith("20px");
    expect(themesMock.default).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        "line-height": "2",
        background: "#141313",
        color: "#e5e2e1",
        "font-family": expect.stringContaining("serif"),
      }),
    }));
  });
});
