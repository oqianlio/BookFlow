import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  logFrontend: vi.fn().mockResolvedValue(undefined),
}));

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom render error");
  return <div>正常内容</div>;
}

describe("ErrorBoundary", () => {
  it("shows fallback UI and logs the error when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // React 会打 error
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/页面出错了/)).toBeInTheDocument();
    expect(screen.getByText(/boom render error/)).toBeInTheDocument();
    expect(screen.getByText(/已写入「设置 → 开发者日志」/)).toBeInTheDocument();
    expect(api.logFrontend).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("ErrorBoundary: boom render error"),
    );
    spy.mockRestore();
  });

  it("recovers via 重试 when the child stops throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let throwing = true;
    const Flaky = () => {
      if (throwing) throw new Error("boom");
      return <div>恢复内容</div>;
    };
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/页面出错了/)).toBeInTheDocument();
    throwing = false;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText(/恢复内容/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children normally when no error", () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText(/正常内容/)).toBeInTheDocument();
  });
});
