import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage, { type SearchHit } from "./pages/DiscoverPage";
import type { Book } from "./services/api";
import "./App.css";

type View =
  | { name: "library" }
  | { name: "reader"; book: Book }
  | { name: "settings" }
  | { name: "discover" }
  | { name: "discoverBook"; hit: SearchHit };

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
        onOpenBook={(hit) => setView({ name: "discoverBook", hit })}
      />
    );
  }
  if (view.name === "discoverBook") {
    return (
      <div className="page">
        <header className="library-header">
          <div className="brand">
            <h1>{view.hit.title}</h1>
            <small>{view.hit.sourceName}</small>
          </div>
          <button className="btn btn-ghost" onClick={() => setView({ name: "discover" })}>返回搜索</button>
        </header>
        <p className="panel-empty">书籍详情页将在后续任务中实现（书源：{view.hit.sourceName}）</p>
      </div>
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
