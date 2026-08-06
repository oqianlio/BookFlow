import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import type { Book } from "./services/api";
import "./App.css";

type View =
  | { name: "library" }
  | { name: "reader"; book: Book }
  | { name: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });

  if (view.name === "reader") {
    return <ReaderPage book={view.book} onBack={() => setView({ name: "library" })} />;
  }
  if (view.name === "settings") {
    return <SettingsPage onBack={() => setView({ name: "library" })} />;
  }
  return (
    <div>
      <LibraryPage onOpenBook={(book) => setView({ name: "reader", book })} />
      <button className="btn-secondary" onClick={() => setView({ name: "settings" })}>设置</button>
    </div>
  );
}
