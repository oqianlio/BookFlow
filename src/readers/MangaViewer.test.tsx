import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MangaViewer from "./MangaViewer";

// jsdom 无 IntersectionObserver：可编程 mock，记录实例并手动触发回调
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private cb: IntersectionObserverCallback;
  private el: Element | null = null;
  private disconnected = false;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.el = el; }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  trigger(intersecting: boolean) {
    if (!this.el || this.disconnected) return;
    this.cb(
      [{ isIntersecting: intersecting, target: this.el, intersectionRatio: intersecting ? 1 : 0 } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe("MangaViewer", () => {
  beforeEach(() => { MockIntersectionObserver.instances = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

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

  it("calls onReachEnd once when the last image enters the viewport", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const onReachEnd = vi.fn();
    render(<MangaViewer images={["https://ex.com/1.jpg", "https://ex.com/2.jpg"]} onReachEnd={onReachEnd} />);
    const obs = MockIntersectionObserver.instances[0];
    expect(obs).toBeDefined();
    obs.trigger(true);
    expect(onReachEnd).toHaveBeenCalledTimes(1);
    // 触发后已断开，重复回调不再触发
    obs.trigger(true);
    expect(onReachEnd).toHaveBeenCalledTimes(1);
  });

  it("does not call onReachEnd while the last image is off-screen", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const onReachEnd = vi.fn();
    render(<MangaViewer images={["https://ex.com/1.jpg"]} onReachEnd={onReachEnd} />);
    MockIntersectionObserver.instances[0].trigger(false);
    expect(onReachEnd).not.toHaveBeenCalled();
  });
});
