import EpubReader from "../readers/EpubReader";
import PdfReader from "../readers/PdfReader";
import MdReader from "../readers/MdReader";
import TxtReader from "../readers/TxtReader";
import type { Book } from "../services/api";
import "./ReaderPage.css";

export default function ReaderPage({ book, onBack }: { book: Book; onBack: () => void }) {
  return (
    <div className="reader-page">
      <header className="reader-toolbar">
        <button className="btn-secondary" onClick={onBack}>返回书架</button>
        <h2>{book.title}</h2>
      </header>
      <main className="reader-main">
        {book.format === "epub" && <EpubReader path={book.path} bookId={book.id} />}
        {book.format === "pdf" && <PdfReader path={book.path} bookId={book.id} />}
        {book.format === "md" && <MdReader path={book.path} bookId={book.id} />}
        {book.format === "txt" && <TxtReader path={book.path} bookId={book.id} />}
      </main>
    </div>
  );
}
