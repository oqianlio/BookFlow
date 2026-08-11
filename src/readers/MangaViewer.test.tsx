import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MangaViewer from "./MangaViewer";

describe("MangaViewer", () => {
  it("renders all images", () => {
    const { container } = render(<MangaViewer images={["https://ex.com/1.jpg", "https://ex.com/2.jpg"]} />);
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("https://ex.com/1.jpg");
  });

  it("shows empty state when no images", () => {
    render(<MangaViewer images={[]} />);
    expect(screen.getByText(/无图片/)).toBeInTheDocument();
  });
});
