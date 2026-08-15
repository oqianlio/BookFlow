import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GroupExplorePage from "./GroupExplorePage";

describe("GroupExplorePage", () => {
  it("renders group name and source list", () => {
    render(<GroupExplorePage groupName="小说" sources={[{ id: 1, name: "源A" }, { id: 2, name: "源B" }]} onBack={() => {}} onOpenExplore={() => {}} />);
    expect(screen.getByText(/小说 · 书源/)).toBeInTheDocument();
    expect(screen.getByText("源A")).toBeInTheDocument();
    expect(screen.getByText("源B")).toBeInTheDocument();
  });

  it("opens a source via onOpenExplore", () => {
    const onOpenExplore = vi.fn();
    render(<GroupExplorePage groupName="小说" sources={[{ id: 1, name: "源A" }]} onBack={() => {}} onOpenExplore={onOpenExplore} />);
    fireEvent.click(screen.getByText("源A"));
    expect(onOpenExplore).toHaveBeenCalledWith(1, "源A");
  });

  it("shows empty state", () => {
    render(<GroupExplorePage groupName="空组" sources={[]} onBack={() => {}} onOpenExplore={() => {}} />);
    expect(screen.getByText(/该分组暂无书源/)).toBeInTheDocument();
  });
});
