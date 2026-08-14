import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorProvider, useError } from "./ErrorDialog";

function Harness() {
  const { showError, clearError } = useError();
  return (
    <div>
      <button onClick={() => showError("测试错误")}>触发</button>
      <button onClick={() => showError("新错误")}>触发新</button>
      <button onClick={clearError}>清除</button>
    </div>
  );
}

function renderWithProvider() {
  return render(<ErrorProvider><Harness /></ErrorProvider>);
}

describe("ErrorDialog", () => {
  beforeEach(() => { vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows error dialog on showError and hides on clearError", async () => {
    renderWithProvider();
    expect(screen.queryByText("出错了")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    expect(screen.getByText("出错了")).toBeInTheDocument();
    expect(screen.getByText("测试错误")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("出错了")).not.toBeInTheDocument();
  });

  it("replaces message on second showError (single dialog)", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    await userEvent.click(screen.getByRole("button", { name: "触发新" }));
    expect(screen.getByText("新错误")).toBeInTheDocument();
    expect(screen.queryByText("测试错误")).not.toBeInTheDocument();
  });

  it("copies error text to clipboard on 复制 click", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "触发" }));
    await userEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("测试错误");
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });
});
