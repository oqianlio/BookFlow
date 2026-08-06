import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnotationPanel from "./AnnotationPanel";
import * as api from "../services/api";

const anns = [
  { id: 1, book_id: 1, format: "epub", location: "cfi1", text: "高亮A", note: null, color: "yellow", created_at: 1 },
];

describe("AnnotationPanel", () => {
  it("renders existing annotations", async () => {
    vi.spyOn(api, "listAnnotations").mockResolvedValue(anns);
    render(<AnnotationPanel bookId={1} format="epub" onJump={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("高亮A")).toBeInTheDocument();
  });

  it("adds an annotation via form", async () => {
    vi.spyOn(api, "listAnnotations").mockResolvedValue([]);
    const addSpy = vi.spyOn(api, "addAnnotation").mockResolvedValue(9);
    render(<AnnotationPanel bookId={1} format="epub" onJump={() => {}} onChanged={() => {}} />);
    await screen.findByText(/暂无标注/);
    await userEvent.type(screen.getByLabelText("标注文本"), "新的高亮");
    await userEvent.click(screen.getByRole("button", { name: /添加标注/ }));
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
  });
});
