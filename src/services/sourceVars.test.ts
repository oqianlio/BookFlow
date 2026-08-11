import { describe, it, expect } from "vitest";
import { getSourceVars, resetSourceVars } from "./sourceVars";

describe("sourceVars", () => {
  it("isolates vars per sourceKey", () => {
    const a = getSourceVars("sourceA");
    a.set("token", "abc");
    expect(getSourceVars("sourceB").get("token")).toBeUndefined();
    expect(getSourceVars("sourceA").get("token")).toBe("abc");
  });

  it("reset clears a source's vars", () => {
    const v = getSourceVars("sourceC");
    v.set("k", "1");
    resetSourceVars("sourceC");
    expect(getSourceVars("sourceC").get("k")).toBeUndefined();
  });
});
