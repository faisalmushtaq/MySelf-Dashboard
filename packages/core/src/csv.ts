/**
 * CSV writing, safe to open in a spreadsheet.
 *
 * FORMULA INJECTION. A participant's free-text answer of `=HYPERLINK(...)` or
 * `@SUM(...)` is data, but Excel, Numbers and Sheets will execute it as a formula
 * when a researcher opens the file. Any text cell whose first character is one a
 * spreadsheet treats as a formula trigger is prefixed with a single quote, which
 * every spreadsheet displays as literal text (OWASP "CSV Injection"). Numbers are
 * written as numbers and are not altered — a negative number is not a formula.
 */

const TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n", "｜", "＝", "＋", "－", "＠"]);

export function neutraliseFormula(text: string): string {
  // Leading whitespace does not stop a spreadsheet evaluating what follows it.
  const first = text.trimStart().charAt(0);
  if (text.length > 0 && (TRIGGERS.has(text.charAt(0)) || TRIGGERS.has(first))) return `'${text}`;
  return text;
}

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const safe = neutraliseFormula(value);
  return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(",");
}

/** RFC 4180 with CRLF line endings, and a BOM so Excel reads UTF-8 correctly. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[], options: { bom?: boolean } = {}): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return `${options.bom === false ? "" : "﻿"}${lines.join("\r\n")}\r\n`;
}
