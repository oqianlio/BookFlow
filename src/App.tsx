import { useEffect, useState } from "react";
import SideNav, { type AppArea } from "./components/SideNav";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import BookSourceManager from "./components/BookSourceManager";
import DiscoverPage, { type ExploreSource } from "./pages/DiscoverPage";
import type { SearchHit } from "./services/searchService";
import GroupExplorePage from "./pages/GroupExplorePage";
import SourceBookPage from "./pages/SourceBookPage";
import ExplorePage from "./pages/ExplorePage";
import DebugSourcePage from "./pages/DebugSourcePage";
import RssPage from "./pages/RssPage";
import RssArticlePage from "./pages/RssArticlePage";
import type { Book } from "./services/api";
import { ErrorProvider } from "./components/ErrorDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import "./App.css";

type OverlayState =
  | { kind: "sourceBook"; hit: SearchHit }
  | { kind: "sourceManager" };

type DetailState =
  | { area: "detail"; page: "reader"; book: Book; jumpTo?: string; back: AppState }
  | { area: "detail"; page: "explore"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "debugSource"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string; back: AppState }
  | { area: "detail"; page: "rssArticle"; articleId: number; back: AppState }
  | { area: "detail"; page: "groupExplore"; groupName: string; sources: ExploreSource[]; back: AppState };

type AppState =
  | { area: "bookshelf"; initialSearch?: string }
  | { area: Exclude<AppArea, "bookshelf"> }
  | DetailState;

function rootArea(s: AppState): AppArea {
  return s.area === "detail" ? rootArea(s.back) : s.area;
}

export default function App() {
  return (
    <ErrorProvider>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </ErrorProvider>
  );
}

function AppInner() {
  const [state, setState] = useState<AppState>({ area: "bookshelf" });
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const area = rootArea(state);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        if (overlay) { setOverlay(null); return; }
        if (state.area === "detail") {
          if (state.page === "sourceReader" || state.page === "reader") return;
          e.preventDefault();
          setState(state.back);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, overlay]);

  const openOnlineBook = (hit: SearchHit) => setOverlay({ kind: "sourceBook", hit });
  const openSourceManager = () => setOverlay({ kind: "sourceManager" });

  const startReadSource = (sourceId: number, bookUrl: string, bookTitle: string, index: number, url: string, name: string) => {
    setOverlay(null);
    setState({
      area: "detail", page: "sourceReader",
      sourceId, bookUrl, bookTitle,
      chapterIndex: index, chapterUrl: url, chapterName: name,
      back: state,
    });
  };

  if (state.area === "detail") {
    const go = (back: AppState) => setState(back);
    const switchSource = (hit: SearchHit, currentTitle: string) => {
      setOverlay({ kind: "sourceBook", hit: { ...hit, title: currentTitle } });
    };
    const sourceBookOverlay = overlay?.kind === "sourceBook" ? (
      <div className="overlay-panel" onClick={() => setOverlay(null)}>
        <div className="overlay-panel-content" onClick={(e) => e.stopPropagation()}>
          <SourceBookPage
            sourceId={overlay.hit.sourceId}
            sourceName={overlay.hit.sourceName}
            bookUrl={overlay.hit.bookUrl}
            initialTitle={overlay.hit.title}
            onBack={() => setOverlay(null)}
            onRead={(index, url, name) => startReadSource(overlay.hit.sourceId, overlay.hit.bookUrl, overlay.hit.title, index, url, name)}
            onSwitchSource={(hit) => setOverlay({ kind: "sourceBook", hit: { ...hit, title: overlay.hit.title } })}
            onSearchAuthor={(author) => { setOverlay(null); setState({ area: "bookshelf", initialSearch: author }); }}
            onEditSource={(sourceId, sourceName) => { setOverlay(null); setState({ area: "detail", page: "debugSource", sourceId, sourceName, back: state }); }}
          />
        </div>
      </div>
    ) : null;
    const sourceManagerOverlay = overlay?.kind === "sourceManager" ? (
      <div className="overlay-panel" onClick={() => setOverlay(null)}>
        <div className="overlay-panel-content" onClick={(e) => e.stopPropagation()}>
          <BookSourceManager
            onBack={() => setOverlay(null)}
            onDebug={(id, name) => {
              setOverlay(null);
              setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: state });
            }}
          />
        </div>
      </div>
    ) : null;
    switch (state.page) {
      case "reader":
        return (<>{sourceBookOverlay}{sourceManagerOverlay}<ReaderPage source={{ kind: "local", book: state.book }} onBack={() => go(state.back)} jumpTo={state.jumpTo} /></>);
      case "explore":
        return (
          <>{sourceBookOverlay}{sourceManagerOverlay}<ExplorePage
            sourceId={state.sourceId}
            sourceName={state.sourceName}
            onBack={() => go(state.back)}
            onOpenBook={(hit) => openOnlineBook(hit)}
          /></>
        );
      case "debugSource":
        return (
          <>{sourceBookOverlay}{sourceManagerOverlay}<DebugSourcePage
            sourceId={state.sourceId}
            sourceName={state.sourceName}
            onBack={() => go(state.back)}
          /></>
        );
      case "sourceReader":
        return (
          <>{sourceBookOverlay}{sourceManagerOverlay}<ReaderPage
            source={{
              kind: "source",
              sourceId: state.sourceId,
              bookUrl: state.bookUrl,
              bookTitle: state.bookTitle,
              chapterIndex: state.chapterIndex,
              chapterUrl: state.chapterUrl,
              chapterName: state.chapterName,
            }}
            onBack={() => go(state.back)}
            onSwitchSource={(hit) => switchSource(hit, state.bookTitle)}
          /></>
        );
      case "rssArticle":
        return (<>{sourceBookOverlay}{sourceManagerOverlay}<RssArticlePage articleId={state.articleId} onBack={() => go(state.back)} /></>);
      case "groupExplore":
        return (
          <>{sourceBookOverlay}{sourceManagerOverlay}<GroupExplorePage
            groupName={state.groupName}
            sources={state.sources}
            onBack={() => go(state.back)}
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: state })}
          /></>
        );
    }
  }

  return (
    <div className="app-shell">
      <SideNav area={area} onSelect={(a) => setState({ area: a })} />
      <main className="app-main">
        {state.area === "bookshelf" && (
          <LibraryPage
            key="bookshelf"
            initialSearch={"initialSearch" in state ? state.initialSearch : undefined}
            onOpenBook={(b, jumpTo) => setState({ area: "detail", page: "reader", book: b, jumpTo, back: state })}
            onOpenSourceBook={(sb) => setState({
              area: "detail", page: "sourceReader",
              sourceId: sb.source_id, bookUrl: sb.book_url, bookTitle: sb.title,
              chapterIndex: -1, chapterUrl: "", chapterName: "", back: state,
            })}
            onOpenOnlineBook={(hit) => openOnlineBook(hit)}
            onOpenInfo={(hit) => openOnlineBook(hit)}
          />
        )}
        {state.area === "discover" && (
          <DiscoverPage
            key="discover"
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: state })}
          />
        )}
        {state.area === "rss" && (
          <RssPage
            key="rss"
            onOpenArticle={(article) => setState({ area: "detail", page: "rssArticle", articleId: article.id, back: state })}
          />
        )}
        {state.area === "my" && (
          <SettingsPage key="my" onOpenSourceManager={openSourceManager} />
        )}
      </main>
    </div>
  );
}
