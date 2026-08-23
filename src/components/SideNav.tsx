import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { BookIcon, SearchIcon, RssIcon, SettingsIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";

export type AppArea = "bookshelf" | "discover" | "rss" | "my";

const ITEMS: Array<{ area: AppArea; label: string; Icon: (p: { size?: number }) => ReactNode }> = [
  { area: "bookshelf", label: "书架", Icon: BookIcon },
  { area: "discover", label: "发现", Icon: SearchIcon },
  { area: "rss", label: "RSS", Icon: RssIcon },
  { area: "my", label: "我的", Icon: SettingsIcon },
];

const COLLAPSE_KEY = "sidenav.collapsed";

function loadCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_KEY) === "1";
}

export default function SideNav({ area, onSelect }: {
  area: AppArea; onSelect: (a: AppArea) => void;
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <nav className={`side-nav${collapsed ? " side-nav-collapsed" : ""}`} aria-label="主导航">
      <div className="side-nav-items">
        {ITEMS.map(({ area: a, label, Icon }) => (
          <button
            key={a}
            type="button"
            className={`side-nav-item${a === area ? " active" : ""}`}
            aria-current={a === area ? "page" : undefined}
            onClick={() => onSelect(a)}
            title={collapsed ? label : undefined}
          >
            <Icon size={20} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="side-nav-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
    </nav>
  );
}
