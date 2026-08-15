import { describe, it, expect, beforeEach } from "vitest";
import { getSessionChapter, setSessionChapter, clearSessionChapterCache } from "./chapterSessionCache";

beforeEach(() => clearSessionChapterCache());

describe("chapterSessionCache", () => {
  it("stores and retrieves a chapter entry", () => {
    setSessionChapter(1, "https://ex.com/book/1.html", "https://ex.com/c/1.html", {
      content: "<p>正文</p>", images: [], isManga: false, nextUrl: "",
    });
    const e = getSessionChapter(1, "https://ex.com/book/1.html", "https://ex.com/c/1.html");
    expect(e?.content).toBe("<p>正文</p>");
  });

  it("isolates entries by source and book", () => {
    setSessionChapter(1, "https://ex.com/book/1.html", "https://ex.com/c/1.html", {
      content: "A", images: [], isManga: false, nextUrl: "",
    });
    expect(getSessionChapter(2, "https://ex.com/book/1.html", "https://ex.com/c/1.html")).toBeUndefined();
    expect(getSessionChapter(1, "https://ex.com/book/2.html", "https://ex.com/c/1.html")).toBeUndefined();
  });

  it("evicts the oldest entry beyond the limit", () => {
    for (let i = 0; i < 35; i++) {
      setSessionChapter(1, `https://ex.com/book/${i}.html`, "https://ex.com/c/1.html", {
        content: `C${i}`, images: [], isManga: false, nextUrl: "",
      });
    }
    expect(getSessionChapter(1, "https://ex.com/book/0.html", "https://ex.com/c/1.html")).toBeUndefined();
    expect(getSessionChapter(1, "https://ex.com/book/34.html", "https://ex.com/c/1.html")?.content).toBe("C34");
  });
});
