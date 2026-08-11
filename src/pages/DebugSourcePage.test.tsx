import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DebugSourcePage from "./DebugSourcePage";
import * as api from "../services/api";
import * as dbg from "../services/sourceDebug";

vi.mock("../services/api", () => ({ listBookSources: vi.fn() }));
vi.mock("../services/sourceDebug", () => ({ debugSource: vi.fn() }));

const sourceJson = JSON.stringify({
  bookSourceUrl: "https://ex.com", bookSourceName: "测试",
  searchUrl: "https://ex.com/search?q={{key}}",
  ruleSearch: { name: ".n@text" },
  ruleContent: { content: "#c@text" },
});

describe("DebugSourcePage", () => {
  it("runs a stage and shows fields", async () => {
    vi.mocked(api.listBookSources).mockResolvedValue([
      { id: 1, name: "测试", url: "https://ex.com", json: sourceJson, enabled: true, last_used_at: null },
    ]);
    vi.mocked(dbg.debugSource).mockResolvedValue({
      html: "<html>摘要</html>",
      fields: [{ name: "name", value: "三体" }],
    });
    render(<DebugSourcePage sourceId={1} sourceName="测试" onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText("URL 或关键词"), "三体");
    await userEvent.click(screen.getByRole("button", { name: /运行/ }));
    expect(await screen.findByText("name")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
  });
});
