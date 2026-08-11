import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage, { type SearchHit } from "./pages/DiscoverPage";
import SourceBookPage from "./pages/SourceBookPage";
import SourceReaderPage from "./pages/SourceReaderPage";
import ExplorePage from "./pages/ExplorePage";
import DebugSourcePage from "./pages/DebugSourcePage";
import type { Book } from "./services/api";
import "./App.css";

type View =
  | { name: "library" }
  | { name: "reader"; book: Book }
  | { name: "settings" }
  | { name: "discover" }
  | { name: "explore"; sourceId: number; sourceName: string }
  | { name: "debugSource"; sourceId: number; sourceName: string }
  | { name: "sourceBook"; hit: SearchHit }
  | { name: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });

  if (view.name === "reader") {
    return <ReaderPage book={view.book} onBack={() => setView({ name: "library" })} />;
  }
  if (view.name === "settings") {
    return (
      <SettingsPage
        onBack={() => setView({ name: "library" })}
        onOpenDebug={(sourceId, sourceName) => setView({ name: "debugSource", sourceId, sourceName })}
      />
    );
  }
  if (view.name === "discover") {
    return (
      <DiscoverPage
        onBack={() => setView({ name: "library" })}
        onOpenBook={(hit) => setView({ name: "sourceBook", hit })}
        onOpenExplore={(id, name) => setView({ name: "explore", sourceId: id, sourceName: name })}
      />
    );
  }
  if (view.name === "explore") {
    return (
      <ExplorePage
        sourceId={view.sourceId}
        sourceName={view.sourceName}
        onBack={() => setView({ name: "discover" })}
        onOpenBook={(hit) => setView({ name: "sourceBook", hit })}
      />
    );
  }
  if (view.name === "debugSource") {
    return (
      <DebugSourcePage
        sourceId={view.sourceId}
        sourceName={view.sourceName}
        onBack={() => setView({ name: "settings" })}
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
        onRead={(index, url, name) => setView({
          name: "sourceReader", sourceId: view.hit.sourceId, bookUrl: view.hit.bookUrl,
          bookTitle: view.hit.title, chapterIndex: index, chapterUrl: url, chapterName: name,
        })}
      />
    );
  }
  if (view.name === "sourceReader") {
    return (
      <SourceReaderPage
        sourceId={view.sourceId}
        bookUrl={view.bookUrl}
        bookTitle={view.bookTitle}
        initialChapterIndex={view.chapterIndex}
        initialChapterUrl={view.chapterUrl}
        initialChapterName={view.chapterName}
        onBack={() => setView({ name: "sourceBook", hit: { title: view.bookTitle, author: "", coverUrl: "", bookUrl: view.bookUrl, sourceId: view.sourceId, sourceName: "" } })}
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
