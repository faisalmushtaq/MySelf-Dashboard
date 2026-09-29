import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvOf, stackedCsvOf, xlsxOf } from "./encode.js";

const table = { name: "t", headers: ["id", "text", "n"], rows: [["a", '=HYPERLINK("x")', 3], ["b", "plain", -1]] };

describe("encoders", () => {
  it("CSV neutralises formulas", () => {
    expect(csvOf(table).toString("utf8")).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("stacked CSV keeps every table and one BOM", () => {
    const out = stackedCsvOf([table, { ...table, name: "u" }]).toString("utf8");
    expect(out.match(/﻿/g)).toHaveLength(1);
    expect(out).toContain("# t");
    expect(out).toContain("# u");
  });

  it("XLSX writes text as text, never as a formula", async () => {
    const buf = await xlsxOf([table], { title: "t", createdBy: "test" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const cell = wb.getWorksheet("t")!.getCell("B2");
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.formula).toBeUndefined();
    expect(wb.getWorksheet("t")!.getCell("C3").value).toBe(-1);
  });
});
