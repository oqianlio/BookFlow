import { describe, it, expect } from "vitest";
import { toSimplified, toTraditional, convertText } from "./tradSimpl";

describe("tradSimpl", () => {
  it("converts traditional to simplified", () => {
    expect(toSimplified("書")).toBe("书");
    expect(toSimplified("開門見山說")).toBe("开门见山说");
    expect(toSimplified("時間過得很快")).toBe("时间过得很快");
    expect(toSimplified("長安東路")).toBe("长安东路");
    expect(toSimplified("手機電量")).toBe("手机电量");
    expect(toSimplified("學生會來學校")).toBe("学生会来学校");
  });

  it("converts simplified to traditional", () => {
    expect(toTraditional("书")).toBe("書");
    expect(toTraditional("开门见山说")).toBe("開門見山說");
    expect(toTraditional("时间过得很快")).toBe("時間過得很快");
    expect(toTraditional("长安东路")).toBe("長安東路");
    expect(toTraditional("手机电量")).toBe("手機電量");
    expect(toTraditional("学生会来学校")).toBe("學生會來學校");
  });

  it("keeps non-dictionary characters as-is", () => {
    expect(toSimplified("abc 123 特殊")).toBe("abc 123 特殊");
  });

  it("convertText passes through for none", () => {
    expect(convertText("繁體內容", "none")).toBe("繁體內容");
    expect(convertText("繁體內容", "simp")).toBe("繁体内容");
    expect(convertText("简体内容", "trad")).toBe("簡體內容");
  });
});
