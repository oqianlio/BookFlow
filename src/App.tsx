import { useState } from "react";
import SideNav, { type AppArea } from "./components/SideNav";
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
  | { area: "detail"; page: "reader"; book: Book; jumpTo?: string; back: AppState }
  | { area: "detail"; page: "explore"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "debugSource"; sourceId: number; sourceName: string; back: AppState }
  | { area: "detail"; page: "sourceManager"; back: AppState }
  | { area: "detail"; page: "sourceBook"; hit: SearchHit; back: AppState }
  | { area: "detail"; page: "sourceReader"; sourceId: number; bookUrl: string; bookTitle: string; chapterIndex: number; chapterUrl: string; chapterName: string; back: AppState }
  | { area: "detail"; page: "rssArticle"; articleId: number; back: AppState }
  | { area: "detail"; page: "groupExplore"; groupName: string; sources: ExploreSource[]; back: AppState };

type AppState = { area: AppArea } | DetailState;

// 递归取根区域（侧边栏高亮）
function rootArea(s: AppState): AppArea {
  return s.area === "detail" ? rootArea(s.back) : s.area;
}

export default function App() {
  return (
    <ErrorProvider>
      <AppInner />
    </ErrorProvider>
  );
}

function AppInner() {
  const [state, setState] = useState<AppState>({ area: "bookshelf" });
  const area = rootArea(state);

  if (state.area === "detail") {
    const go = (back: AppState) => setState(back);
    // 换源统一入口：无论从阅读页还是详情页进入，换源后书名一律以当前所读书名为准（保持同一本书）
    // 换源链折叠：已在书籍详情/阅读页时替换 back（不无限嵌套），连续换源后一步返回
    const switchSource = (hit: SearchHit, currentTitle: string) => {
      const isSourceFlow = state.page === "sourceBook" || state.page === "sourceReader";
      setState({
        area: "detail", page: "sourceBook",
        hit: { ...hit, title: currentTitle },
        back: isSourceFlow ? state.back : state,
      });
    };
    switch (state.page) {
      case "reader":
        return <ReaderPage source={{ kind: "local", book: state.book }} onBack={() => go(state.back)} jumpTo={state.jumpTo} />;
      case "explore":
        return (
          <ExplorePage
            sourceId={state.sourceId}
            sourceName={state.sourceName}
            onBack={() => go(state.back)}
            onOpenBook={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state })}
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
            onDebug={(id, name) => setState({ area: "detail", page: "debugSource", sourceId: id, sourceName: name, back: state })}
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
              chapterIndex: index, chapterUrl: url, chapterName: name, back: state,
            })}
            onSwitchSource={(hit) => switchSource(hit, state.hit.title)}
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
            onBack={() => go(state.back)}
            onSwitchSource={(hit) => switchSource(hit, state.bookTitle)}
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
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: state })}
          />
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
            onOpenBook={(b, jumpTo) => setState({ area: "detail", page: "reader", book: b, jumpTo, back: state })}
            onOpenSourceBook={(sb) => setState({
              area: "detail", page: "sourceReader",
              sourceId: sb.source_id, bookUrl: sb.book_url, bookTitle: sb.title,
              chapterIndex: -1, chapterUrl: "", chapterName: "", back: state,
            })}
          />
        )}
        {state.area === "discover" && (
          <DiscoverPage
            key="discover"
            onOpenBook={(hit) => setState({ area: "detail", page: "sourceBook", hit, back: state })}
            onOpenExplore={(id, name) => setState({ area: "detail", page: "explore", sourceId: id, sourceName: name, back: state })}
            onOpenGroupExplore={(groupName, sources) => setState({ area: "detail", page: "groupExplore", groupName, sources, back: state })}
          />
        )}
        {state.area === "rss" && (
          <RssPage
            key="rss"
            onOpenArticle={(article) => setState({ area: "detail", page: "rssArticle", articleId: article.id, back: state })}
          />
        )}
        {state.area === "my" && (
          <SettingsPage key="my" onOpenSourceManager={() => setState({ area: "detail", page: "sourceManager", back: state })} />
        )}
      </main>
    </div>
  );
}
