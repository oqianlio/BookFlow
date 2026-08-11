import type { Book } from "../services/api";

export default function HomePage(_props: {
  onOpenBook: (b: Book) => void;
  onGoBookshelf: () => void;
}) {
  return <div className="page">首页</div>;
}
