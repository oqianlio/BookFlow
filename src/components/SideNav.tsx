import type { ReactNode } from "react";
import { BookIcon, SearchIcon, RssIcon, SettingsIcon } from "./icons";

export type AppArea = "bookshelf" | "discover" | "rss" | "my";

const ITEMS: Array<{ area: AppArea; label: string; Icon: (p: { size?: number }) => ReactNode }> = [
  { area: "bookshelf", label: "书架", Icon: BookIcon },
  { area: "discover", label: "发现", Icon: SearchIcon },
  { area: "rss", label: "RSS", Icon: RssIcon },
  { area: "my", label: "我的", Icon: SettingsIcon },
];

export default function SideNav({ area, onSelect }: {
  area: AppArea; onSelect: (a: AppArea) => void;
}) {
  return (
    <nav className="side-nav" aria-label="主导航">
      {ITEMS.map(({ area: a, label, Icon }) => (
        <button
          key={a}
          type="button"
          className={`side-nav-item${a === area ? " active" : ""}`}
          aria-current={a === area ? "page" : undefined}
          onClick={() => onSelect(a)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
