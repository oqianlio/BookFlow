import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeveloperLogDialog from "./DeveloperLogDialog";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  readLogs: vi.fn().mockResolvedValue([
    "[2026-08-16 14:00:00] [error] boom",
    "[2026-08-16 14:00:01] [warn] careful",
    "[2026-08-16 14:00:02] [info] all good",
  ]),
  clearLogs: vi.fn().mockResolvedValue(undefined),
  logFileSize: vi.fn().mockResolvedValue(4096),
}));
vi.mock("./ErrorDialog", () => ({
  useError: () => ({ showError: vi.fn() }),
}));

describe("DeveloperLogDialog", () => {
  it("renders logs and file size", async () => {
    render(<DeveloperLogDialog onClose={() => {}} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    expect(screen.getByText(/careful/)).toBeInTheDocument();
    expect(screen.getByText(/all good/)).toBeInTheDocument();
    expect(screen.getByText(/3 行 · 4.0 KB/)).toBeInTheDocument();
  });

  it("filters by error level", async () => {
    render(<DeveloperLogDialog onClose={() => {}} />);
    await screen.findByText(/boom/);
    await userEvent.click(screen.getByRole("button", { name: "错误" }));
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.queryByText(/all good/)).not.toBeInTheDocument();
    expect(screen.queryByText(/careful/)).not.toBeInTheDocument();
  });

  it("clears logs via the clear button", async () => {
    render(<DeveloperLogDialog onClose={() => {}} />);
    await screen.findByText(/boom/);
    await userEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(api.clearLogs).toHaveBeenCalled();
  });
});
