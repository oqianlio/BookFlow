import { useState } from "react";
import SideNav, { type AppArea } from "./components/SideNav";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import BookSourceManager from "./components/BookSourceManager";
import DiscoverPage, { type SearchHit, type ExploreSource } from "./pages/DiscoverPage";
import GroupExplorePage from "./pages/GroupExplorePage";
import SourceBookPage from "./pages/SourceBookPage";
import ExplorePage from "./pages/ExplorePage";
import DebugSourcePage from "./pages/DebugSourcePage";
import RssPage from "./pages/RssPage";
import RssArticlePage from "./pages/RssArticlePage";
import type { Book } from "./services/api";
import { ErrorProvider } from "./components/ErrorDialog";
import "./App.css";

type DetailState =
  | { area: "detail"; page: "reader"; book: Book; back: AppArea }
  | { area: "detail"; page: "explore"; sourceId: number; sourceName: string; back: AppArea }
  | { area: "detail"; page: "debugSource"; sourceId: number; sourceName: string; back: AppArea }
  | { area: "detail"; page: "sourceManager"; back: AppArea }
  | { area: "detail"; page: "sourceBook"; hit: SearchHit; back: AppArea }
  | { area: "detail"; page: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string; back: AppArea }
  | { area: "detail"; page: "rssArticle"; articleId: number; back: AppArea }
  | { area: "detail"; page: "groupExplore"; groupName: string; sources: ExploreSource[]; back: AppArea };

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
        return <ReaderPage source={{ kind: "local", book: state.book }} onBack={() => go(state.back)} />;
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
      case "sourceManager":
        return (
          <BookSourceManager
            onBack={() => go(state.back)}
            onDebug={(id, name) => setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: "my" })}
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
            onSwitchSource={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state.back })}
          />
        );
      case "sourceReader":
        return (
          <ReaderPage
            source={{
              kind: "source",
              sourceId: state.sourceId,
              bookUrl: state.bookUrl,
              bookTitle: state.bookTitle,
              chapterIndex: state.chapterIndex,
              chapterUrl: state.chapterUrl,
              chapterName: state.chapterName,
            }}
            onBack={() => setState({
              area: "detail", page: "sourceBook",
              hit: { title: state.bookTitle, author: "", coverUrl: "", bookUrl: state.bookUrl, sourceId: state.sourceId, sourceName: "" },
              back: state.back,
            })}
            onSwitchSource={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state.back })}
          />
        );
      case "rssArticle":
        return (
          <RssArticlePage articleId={state.articleId} onBack={() => go(state.back)} />
        );
      case "groupExplore":
        return (
          <GroupExplorePage
            groupName={state.groupName}
            sources={state.sources}
            onBack={() => go(state.back)}
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: state.back })}
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
            key="home"
            onGoBookshelf={() => setState({ area: "bookshelf" })}
            onGoDiscover={() => setState({ area: "discover" })}
          />
        )}
        {state.area === "bookshelf" && (
          <LibraryPage
            key="bookshelf"
            onOpenBook={(b) => setState({ area: "detail", page: "reader", book: b, back: "bookshelf" })}
            onOpenSourceBook={(sb) => setState({
              area: "detail", page: "sourceReader",
              sourceId: sb.source_id, bookUrl: sb.book_url, bookTitle: sb.title,
              chapterIndex: -1, chapterUrl: "", chapterName: "", back: "bookshelf",
            })}
          />
        )}
        {state.area === "discover" && (
          <DiscoverPage
            key="discover"
            onOpenBook={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: "discover" })}
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: "discover" })}
            onOpenGroupExplore={(groupName, sources) => setState({ area: "detail", page: "groupExplore", groupName, sources, back: "discover" })}
          />
        )}
        {state.area === "rss" && (
          <RssPage
            key="rss"
            onOpenArticle={(article) => setState({ area: "detail", page: "rssArticle", articleId: article.id, back: "rss" })}
          />
        )}
        {state.area === "my" && (
          <SettingsPage key="my" onOpenSourceManager={() => setState({ area: "detail", page: "sourceManager", back: "my" })} />
        )}
      </main>
    </div>
  );
}
