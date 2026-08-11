import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("shows a per-image placeholder and non-fatal notice on image error", () => {
    const onError = vi.fn();
    const { container } = render(
      <MangaViewer images={["https://ex.com/1.jpg", "https://ex.com/2.jpg"]} onError={onError} />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    fireEvent.error(imgs[0]);
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText("图片加载失败")).toBeInTheDocument();
    expect(screen.getByText("1 张图片加载失败")).toBeInTheDocument();
    expect(container.querySelector(".manga-viewer")).not.toBeNull();
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(screen.getByAltText("图片 2")).toBeInTheDocument();
  });
});
