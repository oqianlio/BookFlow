import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookSourceManager from "./BookSourceManager";
import * as api from "../services/api";

const sources = [
  { id: 1, name: "示例书源", url: "https://ex.com", json: "{}", enabled: true, last_used_at: null },
];

describe("BookSourceManager", () => {
  it("renders sources with enable toggle", async () => {
    vi.spyOn(api, "listBookSources").mockResolvedValue(sources);
    render(<BookSourceManager />);
    expect(await screen.findByText("示例书源")).toBeInTheDocument();
  });

  it("adds a source from pasted JSON", async () => {
    vi.spyOn(api, "listBookSources").mockResolvedValue([]);
    const addSpy = vi.spyOn(api, "addBookSource").mockResolvedValue(5);
    render(<BookSourceManager />);
    await screen.findByText(/暂无书源/);
    fireEvent.change(
      screen.getByLabelText("书源 JSON"),
      { target: { value: '{"bookSourceUrl":"https://ex.com","bookSourceName":"测试"}' } },
    );
    await userEvent.click(screen.getByRole("button", { name: /添加书源/ }));
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
  });
});
