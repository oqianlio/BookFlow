import { describe, it, expect } from "vitest";
import { parseSearchUrl } from "./bookSourceEngine";

describe("parseSearchUrl", () => {
  it("handles plain GET url with {{key}}", () => {
    const r = parseSearchUrl("https://ex.com/search?q={{key}}", "三体");
    expect(r.url).toBe("https://ex.com/search?q=" + encodeURIComponent("三体"));
    expect(r.method).toBeUndefined();
  });

  it("parses legado POST structure", () => {
    const r = parseSearchUrl('https://ex.com/search.php,{"method":"POST","body":"searchkey={{key}}&s=all"}', "三体");
    expect(r.url).toBe("https://ex.com/search.php");
    expect(r.method).toBe("POST");
    expect(r.body).toBe("searchkey=" + encodeURIComponent("三体") + "&s=all");
  });
});
