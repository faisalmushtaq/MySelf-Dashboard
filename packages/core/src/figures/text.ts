import { BOLD, GLYPHS, REGULAR } from "./metrics-data.js";

/**
 * Text measurement for figure layout. Figures are set in Arial/Helvetica, whose
 * advance widths are fixed and public, so layout never depends on the fonts of
 * the machine that draws the preview — a label that fits here fits in the PDF.
 */

const INDEX = new Map<string, number>([...GLYPHS].map((c, i) => [c, i]));
/** Width of a glyph outside the table (roughly an average lowercase letter). */
const FALLBACK = 556;

/** Helvetica's cap height and descender, in em. */
export const CAP_HEIGHT = 0.718;
export const DESCENDER = 0.207;

/** Advance width of `text` at `size` pt, in pt. */
export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? BOLD : REGULAR;
  let units = 0;
  for (const ch of text) {
    const i = INDEX.get(ch);
    units += i === undefined ? FALLBACK : table[i]!;
  }
  return (units / 1000) * size;
}

/** `text`, shortened with an ellipsis if it is wider than `max` pt. */
export function fitText(text: string, max: number, size: number, bold = false): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (textWidth(clean, size, bold) <= max) return clean;
  const ellipsis = "…";
  const room = max - textWidth(ellipsis, size, bold);
  if (room <= 0) return "";
  let out = "";
  let width = 0;
  for (const ch of clean) {
    const w = textWidth(ch, size, bold);
    if (width + w > room) break;
    out += ch;
    width += w;
  }
  return out.replace(/[\s,;:.–-]+$/u, "") + ellipsis;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is fitted. */
export function wrapText(text: string, max: number, size: number, maxLines = 2, bold = false): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (textWidth(next, size, bold) <= max || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i]!;
    if (lines.length === maxLines - 1) {
      line = words.slice(i).join(" ");
      break;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === lines.length - 1 || textWidth(l, size, bold) > max ? fitText(l, max, size, bold) : l));
}
