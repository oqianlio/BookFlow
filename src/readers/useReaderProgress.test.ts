import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReaderProgress } from "./useReaderProgress";
import * as api from "../services/api";

describe("useReaderProgress", () => {
  it("loads saved progress on mount", async () => {
    vi.spyOn(api, "getProgress").mockResolvedValue(["cfi-1", 0.5]);
    const { result } = renderHook(() => useReaderProgress(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.location).toBe("cfi-1");
    expect(result.current.percent).toBe(0.5);
  });

  it("saves progress through api", async () => {
    vi.spyOn(api, "getProgress").mockResolvedValue(null);
    const spy = vi.spyOn(api, "saveProgress").mockResolvedValue();
    const { result } = renderHook(() => useReaderProgress(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.save("cfi-9", 0.9); });
    expect(spy).toHaveBeenCalledWith(7, "cfi-9", 0.9);
  });
});
