import ExcelJS from "exceljs";
import { toCsv, type Table } from "@myself-dashboard/core";

/** One table → CSV (formula-neutralised by core's writer). */
export function csvOf(table: Table): Buffer {
  return Buffer.from(toCsv(table.headers, table.rows), "utf8");
}

/**
 * Several tables → one CSV, stacked with a title line and a blank line between
 * them. Spreadsheets open this directly; each block is a regular table.
 */
export function stackedCsvOf(tables: readonly Table[]): Buffer {
  const parts = tables.map((t, i) => {
    const body = toCsv(t.headers, t.rows, { bom: false });
    return `${i === 0 ? "﻿" : ""}# ${t.name}\r\n${body}`;
  });
  return Buffer.from(parts.join("\r\n"), "utf8");
}

const sheetName = (name: string, used: Set<string>): string => {
  let base = name.replace(/[\\/?*[\]:]/g, "_").slice(0, 28) || "sheet";
  let candidate = base;
  for (let i = 2; used.has(candidate); i += 1) candidate = `${base.slice(0, 25)}_${i}`;
  used.add(candidate);
  base = candidate;
  return base;
};

/**
 * Tables → XLSX, one sheet each. Cells are written as typed values (numbers as
 * numbers, text as text) — never as formulas, so a participant's "=…" is inert.
 */
export async function xlsxOf(tables: readonly Table[], meta: { title: string; createdBy: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.createdBy;
  wb.title = meta.title;
  wb.created = new Date();
  const used = new Set<string>();
  for (const t of tables) {
    const ws = wb.addWorksheet(sheetName(t.name, used), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(t.headers);
    ws.getRow(1).font = { bold: true };
    for (const r of t.rows) {
      ws.addRow(r.map((v) => (v === null || v === undefined ? null : typeof v === "boolean" ? (v ? "true" : "false") : v)));
    }
    ws.columns.forEach((c, i) => {
      c.width = Math.min(60, Math.max(10, (t.headers[i]?.length ?? 10) + 2));
    });
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
