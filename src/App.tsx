import { useState } from "react";
import SideNav, { type AppArea } from "./components/SideNav";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage, { type SearchHit } from "./pages/DiscoverPage";
import SourceBookPage from "./pages/SourceBookPage";
import SourceReaderPage from "./pages/SourceReaderPage";
import ExplorePage from "./pages/ExplorePage";
import DebugSourcePage from "./pages/DebugSourcePage";
import RssPage from "./pages/RssPage";
import type { Book } from "./services/api";
import { ErrorProvider } from "./components/ErrorDialog";
import "./App.css";

type DetailState =
  | { area: "detail"; page: "reader"; book: Book; back: AppArea }
  | { area: "detail"; page: "explore"; sourceId: number; sourceName: string; back: AppArea }
  | { area: "detail"; page: "debugSource"; sourceId: number; sourceName: string; back: AppArea }
  | { area: "detail"; page: "sourceBook"; hit: SearchHit; back: AppArea }
  | { area: "detail"; page: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string; back: AppArea };

type AppState = { area: AppArea } | DetailState;

export default function App() {
  return (
    <ErrorProvider>
      <AppInner />
    </ErrorProvider>
  );
}

function AppInner() {
  const [state, setState] = useState<AppState>({ area: "home" });
  const area = state.area === "detail" ? state.back : state.area;

  if (state.area === "detail") {
    const go = (back: AppArea) => setState({ area: back });
    switch (state.page) {
      case "reader":
        return <ReaderPage book={state.book} onBack={() => go(state.back)} />;
      case "explore":
        return (
          <ExplorePage
            sourceId={state.sourceId}
            sourceName={state.sourceName}
            onBack={() => go(state.back)}
            onOpenBook={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state.back })}
          />
        );
      case "debugSource":
        return (
          <DebugSourcePage
            sourceId={state.sourceId}
            sourceName={state.sourceName}
            onBack={() => go(state.back)}
          />
        );
      case "sourceBook":
        return (
          <SourceBookPage
            sourceId={state.hit.sourceId}
            sourceName={state.hit.sourceName}
            bookUrl={state.hit.bookUrl}
            initialTitle={state.hit.title}
            onBack={() => go(state.back)}
            onRead={(index, url, name) => setState({
              area: "detail", page: "sourceReader", sourceId: state.hit.sourceId,
              bookUrl: state.hit.bookUrl, bookTitle: state.hit.title,
              chapterIndex: index, chapterUrl: url, chapterName: name, back: state.back,
            })}
          />
        );
      case "sourceReader":
        return (
          <SourceReaderPage
            sourceId={state.sourceId}
            bookUrl={state.bookUrl}
            bookTitle={state.bookTitle}
            initialChapterIndex={state.chapterIndex}
            initialChapterUrl={state.chapterUrl}
            initialChapterName={state.chapterName}
            onBack={() => setState({
              area: "detail", page: "sourceBook",
              hit: { title: state.bookTitle, author: "", coverUrl: "", bookUrl: state.bookUrl, sourceId: state.sourceId, sourceName: "" },
              back: state.back,
            })}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      <SideNav area={area} onSelect={(a) => setState({ area: a })} />
      <main className="app-main">
        {state.area === "home" && (
          <HomePage
            onOpenBook={(b) => setState({ area: "detail", page: "reader", book: b, back: "home" })}
            onGoBookshelf={() => setState({ area: "bookshelf" })}
          />
        )}
        {state.area === "bookshelf" && (
          <LibraryPage onOpenBook={(b) => setState({ area: "detail", page: "reader", book: b, back: "bookshelf" })} />
        )}
        {state.area === "discover" && (
          <DiscoverPage
            onOpenBook={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: "discover" })}
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: "discover" })}
          />
        )}
        {state.area === "rss" && <RssPage />}
        {state.area === "my" && (
          <SettingsPage onOpenDebug={(id, name) => setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: "my" })} />
        )}
      </main>
    </div>
  );
}
