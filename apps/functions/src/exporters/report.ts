import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

/**
 * A small report kit on pdfkit: page furniture (running header, footer with
 * "Page N of M"), headings, key-figure tiles, tables that break across pages
 * with their header repeated, bars, tags, callouts and vector figures.
 *
 * Everything is set in pdfkit's built-in Helvetica — the face the figures are
 * measured in — so no font is fetched or embedded and nothing leaves the
 * function. Helvetica here is WinAnsi; `safe` maps what it cannot draw.
 */

export const PAGE = { width: 595.28, height: 841.89, left: 48, right: 48, top: 70, bottom: 58 } as const;
export const CONTENT_W = PAGE.width - PAGE.left - PAGE.right;

export const C = {
  ink: "#1a1a1a",
  secondary: "#4a4a4a",
  muted: "#6e6e6e",
  rule: "#cfcfca",
  hairline: "#e3e3df",
  wash: "#f4f4f2",
  accent: "#067843",
  accentWash: "#e9f3ee",
  bar: "#0072B2",
  track: "#e4e4e0",
  warn: "#8a5a00",
  warnWash: "#fbf3e2",
  danger: "#a4262c",
  dangerWash: "#fbeced",
} as const;

export type Tone = "good" | "warn" | "danger" | "neutral" | "muted";
const TONES: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: C.accent, bg: C.accentWash },
  warn: { fg: C.warn, bg: C.warnWash },
  danger: { fg: C.danger, bg: C.dangerWash },
  neutral: { fg: C.secondary, bg: C.wash },
  muted: { fg: C.muted, bg: "#ffffff" },
};

/** Characters pdfkit's standard fonts can encode beyond Latin-1 (its WinAnsi map). */
const WIN_ANSI_EXTRA = new Set([402, 710, 732, 338, 339, 352, 353, 376, 381, 382, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230, 8240, 8249, 8250, 8364, 8482]);
const SUBSTITUTES: Record<string, string> = { "≈": "~", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "−": "-", "✓": "yes", "✗": "no", " ": " ", " ": " ", " ": " ", "ⁿ": "n", "﻿": "" };

/** Text as Helvetica can draw it; anything else becomes "?" and is recorded. */
export function safe(s: string | null | undefined, lost?: Set<string>): string {
  let out = "";
  for (const ch of s ?? "") {
    const sub = SUBSTITUTES[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code)) out += ch;
    else {
      out += "?";
      lost?.add(ch);
    }
  }
  return out;
}

export interface BarCell {
  bar: number | null;
  /** Shown beside the bar; defaults to the percentage. */
  label?: string;
  /** Optional interval drawn as a whisker, on the same 0–1 scale. */
  interval?: { lo: number; hi: number } | null;
}
export interface TagCell {
  tag: string;
  tone: Tone;
  sub?: string;
}
export interface TextCell {
  text: string;
  sub?: string | undefined;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}
export type Cell = string | number | null | TextCell | BarCell | TagCell;

export interface Column {
  header: string;
  /** Share of the content width. */
  width: number;
  align?: "left" | "right";
}

export interface Row {
  cells: Cell[];
  tone?: Tone;
}

const PAD_X = 4;
const DEF_TERM_W = 128;
const PAD_Y = 3.6;
const BODY = 8.4;
const SUB = 7;

export class Report {
  readonly doc: PDFKit.PDFDocument;
  /** Characters that could not be drawn, so the report can say so. */
  readonly lost = new Set<string>();

  constructor(private readonly meta: { title: string; kind: string; footer: string; subject?: string; author: string }) {
    this.doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
      info: { Title: safe(meta.title), Author: safe(meta.author), Subject: safe(meta.subject ?? meta.kind), Creator: "MySelf Research Dashboard", Producer: "MySelf Research Dashboard" },
      displayTitle: true,
      lang: "en-GB",
    });
    this.doc.fillColor(C.ink).font("Helvetica");
  }

  t(s: string | null | undefined): string {
    return safe(s, this.lost);
  }

  get y(): number {
    return this.doc.y;
  }
  private get bottom(): number {
    return PAGE.height - PAGE.bottom;
  }

  /** A new page unless `height` still fits on this one. */
  ensure(height: number): void {
    if (this.doc.y + height > this.bottom) this.newPage();
  }
  newPage(): void {
    this.doc.addPage();
    this.doc.x = PAGE.left;
    this.doc.y = PAGE.top;
    for (const draw of this.floats.splice(0)) draw();
  }

  /** Figures waiting for the top of the next page, as a typesetter floats them. */
  private readonly floats: (() => void)[] = [];
  space(pt: number): void {
    this.doc.y += pt;
  }

  // ── type ────────────────────────────────────────────────────────────────

  titleBlock(title: string, subtitle: string): void {
    const d = this.doc;
    d.font("Helvetica-Bold").fontSize(21).fillColor(C.ink).text(this.t(title), PAGE.left, d.y, { width: CONTENT_W, lineGap: 1 });
    d.moveDown(0.15);
    d.font("Helvetica").fontSize(10.5).fillColor(C.secondary).text(this.t(subtitle), { width: CONTENT_W, lineGap: 1.5 });
    this.space(12);
  }

  /** Label/value pairs in `cols` columns — the report's "about this file" block. */
  facts(rows: [string, string][], cols = 2): void {
    const d = this.doc;
    const gap = 18;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    for (let i = 0; i < rows.length; i += cols) {
      const chunk = rows.slice(i, i + cols);
      const heights = chunk.map(([, v]) => {
        d.font("Helvetica").fontSize(9);
        return 10 + d.heightOfString(this.t(v), { width: w, lineGap: 1 });
      });
      const h = Math.max(...heights) + 7;
      this.ensure(h);
      const y = d.y;
      chunk.forEach(([k, v], j) => {
        const x = PAGE.left + j * (w + gap);
        d.font("Helvetica-Bold").fontSize(6.8).fillColor(C.muted).text(this.t(k.toUpperCase()), x, y, { width: w, characterSpacing: 0.4, lineBreak: false });
        d.font("Helvetica").fontSize(9).fillColor(C.ink).text(this.t(v), x, y + 10, { width: w, lineGap: 1 });
      });
      d.y = y + h;
    }
    d.x = PAGE.left;
    this.space(4);
  }

  /** "1  Overview" with a rule; never left alone at the foot of a page. */
  heading(number: string | null, text: string, keepWith = 70): void {
    const d = this.doc;
    this.ensure(32 + keepWith);
    this.space(6);
    const y = d.y;
    if (number) d.font("Helvetica-Bold").fontSize(12.5).fillColor(C.accent).text(number, PAGE.left, y, { lineBreak: false });
    d.font("Helvetica-Bold").fontSize(12.5).fillColor(C.ink).text(this.t(text), PAGE.left + (number ? 20 : 0), y, { width: CONTENT_W - 20, lineBreak: false });
    d.moveTo(PAGE.left, y + 17).lineTo(PAGE.left + CONTENT_W, y + 17).lineWidth(0.6).strokeColor(C.rule).stroke();
    d.x = PAGE.left;
    d.y = y + 24;
  }

  subheading(text: string, note?: string): void {
    const d = this.doc;
    this.ensure(40);
    this.space(3);
    d.font("Helvetica-Bold").fontSize(9.6).fillColor(C.ink).text(this.t(text), PAGE.left, d.y, { width: CONTENT_W, continued: !!note });
    if (note) d.font("Helvetica").fontSize(8.4).fillColor(C.muted).text(this.t(`   ${note}`));
    this.space(4);
  }

  paragraph(text: string, o: { size?: number; color?: string; italic?: boolean; after?: number } = {}): void {
    const d = this.doc;
    d.font(o.italic ? "Helvetica-Oblique" : "Helvetica").fontSize(o.size ?? 8.8);
    const h = d.heightOfString(this.t(text), { width: CONTENT_W, lineGap: 1.6 });
    this.ensure(Math.min(h, 60));
    d.fillColor(o.color ?? C.secondary).text(this.t(text), PAGE.left, d.y, { width: CONTENT_W, lineGap: 1.6 });
    this.space(o.after ?? 6);
  }

  definitionsHeight(items: [string, string][]): number {
    const d = this.doc.font("Helvetica").fontSize(8.2);
    return items.reduce((s, [, text]) => s + Math.max(d.heightOfString(this.t(text), { width: CONTENT_W - DEF_TERM_W, lineGap: 1.4 }), 10) + 4, 2);
  }

  /** Short definitions: a bold term then its explanation, as a hanging list. */
  definitions(items: [string, string][]): void {
    const d = this.doc;
    const termW = DEF_TERM_W;
    for (const [term, text] of items) {
      d.font("Helvetica").fontSize(8.2);
      const h = Math.max(d.heightOfString(this.t(text), { width: CONTENT_W - termW, lineGap: 1.4 }), 10);
      this.ensure(h + 4);
      const y = d.y;
      d.font("Helvetica-Bold").fontSize(8.2).fillColor(C.ink).text(this.t(term), PAGE.left, y, { width: termW - 8 });
      d.font("Helvetica").fontSize(8.2).fillColor(C.secondary).text(this.t(text), PAGE.left + termW, y, { width: CONTENT_W - termW, lineGap: 1.4 });
      d.y = Math.max(d.y, y + h) + 4;
    }
    d.x = PAGE.left;
    this.space(2);
  }

  // ── tiles, bars, tags, callouts ─────────────────────────────────────────

  /** Key figures as tiles: a large value, what it counts, and a note on its basis. */
  tiles(items: { value: string; label: string; note?: string; tone?: Tone }[], perRow = 4): void {
    const d = this.doc;
    const gap = 8;
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      const noteH = Math.max(
        0,
        ...row.map((it) => {
          d.font("Helvetica").fontSize(6.9);
          return it.note ? d.heightOfString(this.t(it.note), { width: w - 16, lineGap: 0.8 }) : 0;
        }),
      );
      const h = 50 + noteH;
      this.ensure(h + gap);
      const y = d.y;
      row.forEach((it, j) => {
        const x = PAGE.left + j * (w + gap);
        const tone = TONES[it.tone ?? "neutral"];
        d.roundedRect(x, y, w, h, 4).fillColor(C.wash).fill();
        d.rect(x, y + 4, 2.4, h - 8).fillColor(it.tone && it.tone !== "neutral" ? tone.fg : C.rule).fill();
        d.font("Helvetica-Bold").fontSize(18).fillColor(C.ink).text(this.t(it.value), x + 10, y + 8, { width: w - 16, lineBreak: false });
        d.font("Helvetica-Bold").fontSize(7.6).fillColor(C.secondary).text(this.t(it.label), x + 10, y + 31, { width: w - 16, lineBreak: false, ellipsis: true });
        if (it.note) d.font("Helvetica").fontSize(6.9).fillColor(C.muted).text(this.t(it.note), x + 10, y + 42, { width: w - 16, lineGap: 0.8 });
      });
      d.x = PAGE.left;
      d.y = y + h + gap;
    }
    this.space(4);
  }

  /** A horizontal bar on [0, 1] with an optional whisker. */
  bar(x: number, y: number, w: number, value: number | null, interval?: { lo: number; hi: number } | null, h = 5): void {
    const d = this.doc;
    d.rect(x, y, w, h).fillColor(C.track).fill();
    if (value !== null && value > 0) d.rect(x, y, Math.max(0.8, w * Math.min(1, value)), h).fillColor(C.bar).fill();
    if (interval) {
      const lo = x + w * interval.lo;
      const hi = x + w * interval.hi;
      const mid = y + h / 2;
      d.lineWidth(0.7).strokeColor(C.ink);
      d.moveTo(lo, mid).lineTo(hi, mid).stroke();
      d.moveTo(lo, mid - 2.6).lineTo(lo, mid + 2.6).stroke();
      d.moveTo(hi, mid - 2.6).lineTo(hi, mid + 2.6).stroke();
    }
  }

  /** A pill with its label — never colour alone. Returns its width. */
  tag(x: number, y: number, text: string, tone: Tone, size = 7.2, onTint = false): number {
    const d = this.doc;
    const t = TONES[tone];
    d.font("Helvetica-Bold").fontSize(size);
    const label = this.t(text);
    const w = d.widthOfString(label) + 9;
    const h = size + 5;
    d.roundedRect(x, y, w, h, h / 2).fillColor(onTint ? "#ffffff" : t.bg).fill();
    if (tone === "muted" || onTint) d.roundedRect(x, y, w, h, h / 2).lineWidth(0.5).strokeColor(onTint ? t.fg : C.rule).stroke();
    d.fillColor(t.fg).text(label, x + 4.5, y + 2.7, { lineBreak: false });
    return w;
  }

  /** A boxed note with a coloured edge and a title. */
  callout(tone: Tone, title: string, lines: string[]): void {
    if (!lines.length) return;
    const d = this.doc;
    const t = TONES[tone];
    const inner = CONTENT_W - 22;
    d.font("Helvetica").fontSize(8.4);
    const bodyH = lines.reduce((s, l) => s + d.heightOfString(this.t(l), { width: inner - 8, lineGap: 1.2 }) + 2, 0);
    const h = 22 + bodyH + 6;
    this.ensure(h + 8);
    const y = d.y;
    d.roundedRect(PAGE.left, y, CONTENT_W, h, 4).fillColor(t.bg === "#ffffff" ? C.wash : t.bg).fill();
    d.rect(PAGE.left, y, 3, h).fillColor(t.fg).fill();
    d.font("Helvetica-Bold").fontSize(8.8).fillColor(t.fg).text(this.t(title), PAGE.left + 13, y + 8, { width: inner });
    let ly = y + 22;
    for (const l of lines) {
      d.font("Helvetica").fontSize(8.4).fillColor(C.ink);
      d.circle(PAGE.left + 16, ly + 4, 1.2).fillColor(C.secondary).fill();
      d.fillColor(C.ink).text(this.t(l), PAGE.left + 22, ly, { width: inner - 8, lineGap: 1.2 });
      ly = d.y + 2;
    }
    d.x = PAGE.left;
    d.y = y + h + 8;
  }

  // ── tables ──────────────────────────────────────────────────────────────

  private cellHeight(cell: Cell, w: number): number {
    const d = this.doc;
    if (cell === null || typeof cell === "string" || typeof cell === "number") {
      d.font("Helvetica").fontSize(BODY);
      return d.heightOfString(this.t(cell === null ? "–" : String(cell)), { width: w, lineGap: 1.2 });
    }
    if ("bar" in cell) return 9;
    if ("tag" in cell) {
      if (!cell.sub) return 12;
      d.font("Helvetica").fontSize(SUB);
      return 14 + d.heightOfString(this.t(cell.sub), { width: w, lineGap: 0.6 });
    }
    d.font(cell.bold ? "Helvetica-Bold" : cell.italic ? "Helvetica-Oblique" : "Helvetica").fontSize(BODY);
    let h = d.heightOfString(this.t(cell.text), { width: w, lineGap: 1.2 });
    if (cell.sub) {
      d.font("Helvetica").fontSize(SUB);
      h += 1.5 + d.heightOfString(this.t(cell.sub), { width: w, lineGap: 0.6 });
    }
    return h;
  }

  private drawCell(cell: Cell, x: number, y: number, w: number, align: "left" | "right", rowTone?: Tone): void {
    const d = this.doc;
    if (cell === null || typeof cell === "string" || typeof cell === "number") {
      const text = cell === null ? "–" : String(cell);
      d.font("Helvetica").fontSize(BODY).fillColor(cell === null ? C.muted : C.ink).text(this.t(text), x, y, { width: w, align, lineGap: 1.2 });
      return;
    }
    if ("bar" in cell) {
      const label = cell.label ?? (cell.bar === null ? "n/a" : `${Math.round(cell.bar * 100)}%`);
      const labelW = 30;
      d.font("Helvetica").fontSize(BODY).fillColor(cell.bar === null ? C.muted : C.ink).text(this.t(label), x, y, { width: labelW - 4, align: "right", lineBreak: false });
      if (cell.bar !== null) this.bar(x + labelW, y + 2.2, w - labelW, cell.bar, cell.interval ?? null);
      return;
    }
    if ("tag" in cell) {
      this.tag(x, y - 0.5, cell.tag, cell.tone, 7.2, rowTone === cell.tone);
      if (cell.sub) d.font("Helvetica").fontSize(SUB).fillColor(C.muted).text(this.t(cell.sub), x, y + 14, { width: w, lineGap: 0.6 });
      return;
    }
    d.font(cell.bold ? "Helvetica-Bold" : cell.italic ? "Helvetica-Oblique" : "Helvetica")
      .fontSize(BODY)
      .fillColor(cell.color ?? C.ink)
      .text(this.t(cell.text), x, y, { width: w, align, lineGap: 1.2 });
    if (cell.sub) {
      d.font("Helvetica").fontSize(SUB).fillColor(C.muted).text(this.t(cell.sub), x, d.y + 1.5, { width: w, align, lineGap: 0.6 });
    }
  }

  private tableHeader(columns: Column[], widths: number[]): void {
    const d = this.doc;
    const y = d.y;
    let x = PAGE.left;
    columns.forEach((c, i) => {
      const label = this.t(c.header.toUpperCase());
      const room = widths[i]! - 2 * PAD_X;
      let size = 6.8;
      d.font("Helvetica-Bold");
      while (size > 5.2 && d.fontSize(size).widthOfString(label, { characterSpacing: 0.3 }) > room) size -= 0.2;
      d.fontSize(size).fillColor(C.muted).text(label, x + PAD_X, y + (6.8 - size), { width: room, align: c.align ?? "left", characterSpacing: 0.3, lineBreak: false });
      x += widths[i]!;
    });
    d.moveTo(PAGE.left, y + 11).lineTo(PAGE.left + CONTENT_W, y + 11).lineWidth(0.8).strokeColor(C.ink).stroke();
    d.y = y + 13;
  }

  /** A ruled table; rows never split, and the header repeats on a new page. */
  table(columns: Column[], rows: Row[], o: { empty?: string } = {}): void {
    const d = this.doc;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    if (!rows.length) {
      this.paragraph(o.empty ?? "Nothing to show.", { italic: true, color: C.muted });
      return;
    }
    const heightOf = (r: Row) => Math.max(...r.cells.map((cell, i) => this.cellHeight(cell, widths[i]! - 2 * PAD_X))) + 2 * PAD_Y;
    this.ensure(14 + heightOf(rows[0]!));
    this.tableHeader(columns, widths);
    rows.forEach((r, ri) => {
      const h = heightOf(r);
      if (d.y + h > this.bottom) {
        this.newPage();
        this.tableHeader(columns, widths);
      }
      const y = d.y;
      if (r.tone && r.tone !== "neutral" && r.tone !== "muted") d.rect(PAGE.left, y, CONTENT_W, h).fillColor(TONES[r.tone].bg).fill();
      let x = PAGE.left;
      r.cells.forEach((cell, i) => {
        this.drawCell(cell, x + PAD_X, y + PAD_Y, widths[i]! - 2 * PAD_X, columns[i]!.align ?? "left", r.tone);
        x += widths[i]!;
      });
      if (ri < rows.length - 1) d.moveTo(PAGE.left, y + h).lineTo(PAGE.left + CONTENT_W, y + h).lineWidth(0.4).strokeColor(C.hairline).stroke();
      d.y = y + h;
    });
    d.moveTo(PAGE.left, d.y).lineTo(PAGE.left + CONTENT_W, d.y).lineWidth(0.6).strokeColor(C.rule).stroke();
    d.x = PAGE.left;
    this.space(10);
  }

  // ── figures ─────────────────────────────────────────────────────────────

  /**
   * A figure from the dashboard's publication renderer, drawn as vectors (so it
   * prints sharp and its text stays text), scaled to the text width at most,
   * with its legend set beneath.
   */
  figure(svg: string, widthPt: number, heightPt: number, legend: string): void {
    const d = this.doc;
    const scale = Math.min(1, CONTENT_W / widthPt);
    const w = widthPt * scale;
    const h = heightPt * scale;
    d.font("Helvetica").fontSize(7.8);
    const legendH = d.heightOfString(this.t(legend), { width: CONTENT_W, lineGap: 1.2 });
    const draw = () => this.drawFigure(svg, w, h, legend);
    // Rather than leave the rest of this page empty, let the text run on and
    // set the figure at the top of the next page.
    if (d.y + h + 22 + legendH > this.bottom && d.y > PAGE.top + 1) this.floats.push(draw);
    else draw();
  }

  private drawFigure(svg: string, w: number, h: number, legend: string): void {
    const d = this.doc;
    const y = d.y + 4;
    const x = PAGE.left + (CONTENT_W - w) / 2;
    const sized = this.t(svg).replace(/<svg\b([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${w}" height="${h}"`);
    SVGtoPDF(d, sized, x, y, {
      width: w,
      height: h,
      assumePt: true,
      fontCallback: (_family: string, bold: boolean, italic: boolean) => (bold ? (italic ? "Helvetica-BoldOblique" : "Helvetica-Bold") : italic ? "Helvetica-Oblique" : "Helvetica"),
    });
    d.x = PAGE.left;
    d.y = y + h + 8;
    d.font("Helvetica").fontSize(7.8).fillColor(C.secondary).text(this.t(legend), PAGE.left, d.y, { width: CONTENT_W, lineGap: 1.2 });
    this.space(10);
  }

  // ── page furniture ──────────────────────────────────────────────────────

  private furniture(): void {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      d.switchToPage(i);
      const saved = d.page.margins.bottom;
      d.page.margins.bottom = 0;
      // Running head.
      d.font("Helvetica-Bold").fontSize(7.6).fillColor(C.accent).text("MySelf", PAGE.left, 30, { lineBreak: false, continued: true });
      d.font("Helvetica").fillColor(C.secondary).text(this.t(`  Research Dashboard  ·  ${this.meta.kind}`), { lineBreak: false });
      d.font("Helvetica-Bold").fontSize(6.8).fillColor(C.danger).text("CONFIDENTIAL RESEARCH DATA", PAGE.left, 31, { width: CONTENT_W, align: "right", characterSpacing: 0.4, lineBreak: false });
      d.moveTo(PAGE.left, 44).lineTo(PAGE.left + CONTENT_W, 44).lineWidth(0.6).strokeColor(C.rule).stroke();
      // Footer.
      const fy = PAGE.height - 38;
      d.moveTo(PAGE.left, fy - 6).lineTo(PAGE.left + CONTENT_W, fy - 6).lineWidth(0.4).strokeColor(C.hairline).stroke();
      d.font("Helvetica").fontSize(6.8).fillColor(C.muted).text(this.t(this.meta.footer), PAGE.left, fy, { width: CONTENT_W - 70, lineGap: 0.8 });
      d.font("Helvetica-Bold").fontSize(7.2).fillColor(C.secondary).text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.left, fy, { width: CONTENT_W, align: "right", lineBreak: false });
      d.page.margins.bottom = saved;
    }
  }

  finish(): Promise<Buffer> {
    if (this.floats.length) this.newPage();
    this.furniture();
    const d = this.doc;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      d.on("data", (c: Buffer) => chunks.push(c));
      d.on("end", () => resolve(Buffer.concat(chunks)));
      d.on("error", reject);
      d.end();
    });
  }
}

/** "12 Sep 2026, 14:05" in the study's time zone. */
export function formatWhen(iso: string | null | undefined, timeZone: string, withTime = true): string {
  if (!iso) return "–";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "–";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(t);
}

export function formatMinutes(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)} s`;
  if (min < 90) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min - h * 60)} min`;
}

export const pct = (n: number | null | undefined, digits = 0): string => (n === null || n === undefined ? "n/a" : `${(n * 100).toFixed(digits)}%`);
