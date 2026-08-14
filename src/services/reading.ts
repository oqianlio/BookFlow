import type { Book } from "./api";

export type ReaderSource =
  | { kind: "local"; book: Book }
  | { kind: "source"; sourceId: number; bookUrl: string; bookTitle: string;
      chapterIndex: number; chapterUrl: string; chapterName: string };
