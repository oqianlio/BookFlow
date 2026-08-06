import type { Book } from "../services/api";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  return <div><button onClick={onBack}>返回</button><h2>{book.title}</h2></div>;
}
