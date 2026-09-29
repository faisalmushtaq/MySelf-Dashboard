import { describe, expect, it } from "vitest";
import { csvCell, neutraliseFormula, toCsv } from "./csv.js";

describe("CSV formula-injection protection", () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["\t=1", "'\t=1"],
    ["\r=1", `"'\r=1"`],
    ["  =1", "'  =1"],
    ["＝1", "'＝1"],
  ])("neutralises %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("leaves ordinary text and numbers alone", () => {
    expect(csvCell("Keep going")).toBe("Keep going");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(3.5)).toBe("3.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(neutraliseFormula("a=b")).toBe("a=b");
  });

  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
  });

  it("writes a BOM and CRLF line endings, and neutralises headers too", () => {
    const out = toCsv(["a", "=b"], [["x", 1]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿a,'=b\r\nx,1\r\n");
  });
});
