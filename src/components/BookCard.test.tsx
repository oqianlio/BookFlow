import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import BookCard, { formatLabel, formatRelativeTime } from "./BookCard";
import type { ShelfItem } from "./BookCard";

// Mock API calls
vi.mock("../services/api", () => ({
  coverUrl: vi.fn((url: string) => url),
  getProgress: vi.fn().mockResolvedValue(50),
  getBookSourceProgress: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/sourceToc", () => ({
  fetchToc: vi.fn().mockResolvedValue({ toc: [] }),
}));

describe("formatLabel", () => {
  it("converts format to uppercase", () => {
    expect(formatLabel("epub")).toBe("EPUB");
    expect(formatLabel("PDF")).toBe("PDF");
    expect(formatLabel("md")).toBe("MD");
  });
});

describe("formatRelativeTime", () => {
  const now = 1000000000; // Fixed timestamp for testing

  it("returns '刚刚' for recent times", () => {
    expect(formatRelativeTime(now - 1800, now)).toBe("刚刚"); // 30 minutes ago
    expect(formatRelativeTime(now - 100, now)).toBe("刚刚"); // 100 seconds ago
  });

  it("returns hours for times within a day", () => {
    expect(formatRelativeTime(now - 7200, now)).toBe("2 小时前"); // 2 hours ago
    expect(formatRelativeTime(now - 3600, now)).toBe("1 小时前"); // 1 hour ago
  });

  it("returns days for times within a week", () => {
    expect(formatRelativeTime(now - 172800, now)).toBe("2 天前"); // 2 days ago
    expect(formatRelativeTime(now - 86400, now)).toBe("1 天前"); // 1 day ago
  });

  it("returns date for older times", () => {
    const result = formatRelativeTime(now - 604800, now); // 7 days ago
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("BookCard", () => {
  const mockOnOpen = vi.fn();

  const localItem: ShelfItem = {
    kind: "local",
    book: {
      id: 1,
      title: "测试书籍",
      format: "epub",
      path: "/path/to/book.epub",
      cover_path: null,
      added_at: 1000000000,
      last_opened_at: null,
    },
  };

  const sourceItem: ShelfItem = {
    kind: "source",
    sb: {
      id: 1,
      source_id: 1,
      source_name: "测试书源",
      book_url: "https://example.com/book",
      title: "在线书籍",
      author: "在线作者",
      cover_url: "https://example.com/cover.jpg",
      added_at: 1000000000,
      last_opened_at: null,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders local book title", () => {
    render(
      <BookCard
        item={localItem}
        onOpen={mockOnOpen}
        layout="grid"
      />
    );
    expect(screen.getByText("测试书籍")).toBeTruthy();
  });

  it("renders source book title", () => {
    render(
      <BookCard
        item={sourceItem}
        onOpen={mockOnOpen}
        layout="grid"
      />
    );
    expect(screen.getByText("在线书籍")).toBeTruthy();
  });

  it("calls onOpen when clicked", () => {
    render(
      <BookCard
        item={localItem}
        onOpen={mockOnOpen}
        layout="grid"
      />
    );
    fireEvent.click(screen.getByText("测试书籍"));
    expect(mockOnOpen).toHaveBeenCalledWith(localItem);
  });

  it("renders in list layout", () => {
    render(
      <BookCard
        item={localItem}
        onOpen={mockOnOpen}
        layout="list"
      />
    );
    expect(screen.getByText("测试书籍")).toBeTruthy();
  });

  it("renders in compact layout", () => {
    render(
      <BookCard
        item={localItem}
        onOpen={mockOnOpen}
        layout="compact"
      />
    );
    expect(screen.getByText("测试书籍")).toBeTruthy();
  });
});
