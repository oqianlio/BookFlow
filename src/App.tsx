import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage, { type SearchHit } from "./pages/DiscoverPage";
import SourceBookPage from "./pages/SourceBookPage";
import type { Book } from "./services/api";
import "./App.css";

type View =
  | { name: "library" }
  | { name: "reader"; book: Book }
  | { name: "settings" }
  | { name: "discover" }
  | { name: "sourceBook"; hit: SearchHit };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });

  if (view.name === "reader") {
    return <ReaderPage book={view.book} onBack={() => setView({ name: "library" })} />;
  }
  if (view.name === "settings") {
    return <SettingsPage onBack={() => setView({ name: "library" })} />;
  }
  if (view.name === "discover") {
    return (
      <DiscoverPage
        onBack={() => setView({ name: "library" })}
        onOpenBook={(hit) => setView({ name: "sourceBook", hit })}
      />
    );
  }
  if (view.name === "sourceBook") {
    return (
      <SourceBookPage
        sourceId={view.hit.sourceId}
        sourceName={view.hit.sourceName}
        bookUrl={view.hit.bookUrl}
        initialTitle={view.hit.title}
        onBack={() => setView({ name: "discover" })}
        onRead={() => {}}
      />
    );
  }
  return (
    <div className="app">
      <LibraryPage
        onOpenBook={(book) => setView({ name: "reader", book })}
        onOpenSettings={() => setView({ name: "settings" })}
        onOpenDiscover={() => setView({ name: "discover" })}
      />
    </div>
  );
}
