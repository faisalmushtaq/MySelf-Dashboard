import { el, type El } from "./svg.js";
import { CAP_HEIGHT, DESCENDER, fitText, textWidth, wrapText } from "./text.js";
import type { Box } from "./types.js";
import type { Theme } from "./theme.js";
import type { Scale } from "./scale.js";

/**
 * Drawing primitives shared by the panels: text, axes, category labels and the
 * legend key. All measurements are in points.
 */

/** Space above the plot for the panel letter and the legend key. */
export const TOP = 11;
export const LEGEND_LINE = 7.5;
/** Horizontal gap between category labels (or tick labels) and the plot. */
const LABEL_GAP = 1.5;
const TITLE_GAP = 3;

type Anchor = "start" | "middle" | "end";

export function text(x: number, y: number, s: string, theme: Theme, o: { size?: number; anchor?: Anchor; bold?: boolean; rotate?: number } = {}): El {
  return el(
    "text",
    {
      x,
      y,
      "font-size": o.size ?? theme.size.tick,
      "font-weight": o.bold ? "bold" : undefined,
      "text-anchor": o.anchor && o.anchor !== "start" ? o.anchor : undefined,
      transform: o.rotate ? `rotate(${o.rotate} ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100})` : undefined,
    },
    s,
  );
}

/** Baseline that vertically centres capitals on `y`. */
export function centreBaseline(y: number, size: number): number {
  return y + (size * CAP_HEIGHT) / 2;
}

export function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, dash?: string | null): El {
  return el("line", { x1, y1, x2, y2, stroke, "stroke-width": width, "stroke-dasharray": dash ?? undefined });
}

export function panelLetter(letter: string, box: Box, theme: Theme): El {
  return text(box.x, box.y + theme.size.panel * CAP_HEIGHT, letter, theme, { size: theme.size.panel, bold: true });
}

// ── Value axes ─────────────────────────────────────────────────────────────────

export interface TickLabel {
  value: number;
  label: string;
}

/** Width a left value axis needs: title, tick labels, gap and ticks. */
export function leftAxisWidth(ticks: readonly TickLabel[], theme: Theme, withTitle: boolean): number {
  const widest = Math.max(0, ...ticks.map((t) => textWidth(t.label, theme.size.tick)));
  return (withTitle ? theme.size.label * CAP_HEIGHT + TITLE_GAP + 0.5 : 0) + widest + LABEL_GAP + theme.stroke.tickLength;
}

/** Height a bottom axis needs under the plot. */
export function bottomAxisHeight(theme: Theme, withTitle: boolean): number {
  return (
    theme.stroke.tickLength +
    LABEL_GAP +
    theme.size.tick * CAP_HEIGHT +
    (withTitle ? TITLE_GAP + theme.size.label * CAP_HEIGHT : 0) +
    theme.size.label * DESCENDER +
    0.5
  );
}

export function leftAxis(o: { box: Box; x: number; top: number; bottom: number; scale: Scale; ticks: readonly TickLabel[]; title?: string; theme: Theme }): El[] {
  const { theme } = o;
  const out: El[] = [line(o.x, o.top, o.x, o.bottom, theme.palette.ink, theme.stroke.axis)];
  for (const t of o.ticks) {
    const y = o.scale(t.value);
    out.push(line(o.x - theme.stroke.tickLength, y, o.x, y, theme.palette.ink, theme.stroke.tick));
    out.push(text(o.x - theme.stroke.tickLength - LABEL_GAP, centreBaseline(y, theme.size.tick), t.label, theme, { anchor: "end" }));
  }
  if (o.title) {
    const x = o.box.x + theme.size.label * CAP_HEIGHT + 0.5;
    const y = (o.top + o.bottom) / 2;
    out.push(text(x, y, fitText(o.title, o.bottom - o.top + 8, theme.size.label), theme, { size: theme.size.label, anchor: "middle", rotate: -90 }));
  }
  return out;
}

export function bottomAxis(o: { box: Box; left: number; right: number; y: number; scale: Scale; ticks: readonly TickLabel[]; title?: string; theme: Theme; ticksOnly?: boolean }): El[] {
  const { theme } = o;
  const out: El[] = [line(o.left, o.y, o.right, o.y, theme.palette.ink, theme.stroke.axis)];
  const labelY = o.y + theme.stroke.tickLength + LABEL_GAP + theme.size.tick * CAP_HEIGHT;
  for (const t of o.ticks) {
    const x = o.scale(t.value);
    out.push(line(x, o.y, x, o.y + theme.stroke.tickLength, theme.palette.ink, theme.stroke.tick));
    if (!o.ticksOnly) out.push(text(x, labelY, t.label, theme, { anchor: "middle" }));
  }
  if (o.title) {
    // Centred under the plot, but never past the panel's edges.
    const title = fitText(o.title, o.box.width, theme.size.label);
    const half = textWidth(title, theme.size.label) / 2;
    const cx = Math.min(o.box.x + o.box.width - half, Math.max(o.box.x + half, (o.left + o.right) / 2));
    out.push(text(cx, labelY + TITLE_GAP + theme.size.label * CAP_HEIGHT, title, theme, { size: theme.size.label, anchor: "middle" }));
  }
  return out;
}

/** Drop tick labels that would touch their neighbour (keeping first and last). */
export function thinTicks(ticks: readonly TickLabel[], scale: Scale, theme: Theme, minGap = 3): TickLabel[] {
  const fits = (set: readonly TickLabel[]) =>
    set.every((t, i) => {
      if (i === 0) return true;
      const prev = set[i - 1]!;
      const a = scale(prev.value) + textWidth(prev.label, theme.size.tick) / 2;
      const b = scale(t.value) - textWidth(t.label, theme.size.tick) / 2;
      return b - a >= minGap;
    });
  if (fits(ticks)) return [...ticks];
  for (let every = 2; every < ticks.length; every += 1) {
    const set = ticks.filter((_, i) => i % every === 0);
    if (fits(set)) return set;
  }
  return ticks.length ? [ticks[0]!] : [];
}

// ── Category axes (horizontal bar and dot charts) ─────────────────────────────

export interface Rows {
  /** Centre line of row i. */
  centre: (i: number) => number;
  pitch: number;
}

export function rowsIn(top: number, bottom: number, count: number): Rows {
  const pitch = (bottom - top) / Math.max(1, count);
  return { pitch, centre: (i) => top + pitch * (i + 0.5) };
}

/** Line spacing of two-line row labels. */
const LABEL_LEADING = 1.2;

/** Whether any label needs a second line at `cap` pt wide. */
export function labelsWrap(labels: readonly string[], cap: number, theme: Theme): boolean {
  return labels.some((l) => textWidth(l.replace(/\s+/g, " ").trim(), theme.size.tick) > cap);
}

/** Row pitch that leaves room for two-line labels when they need it. */
export function rowPitch(labels: readonly string[], cap: number, theme: Theme, base: number): number {
  return labelsWrap(labels, cap, theme) ? Math.max(base, theme.size.tick * LABEL_LEADING * 2 + 3.2) : base;
}

/**
 * Right-aligned row labels ending `LABEL_GAP` before the axis. Long labels wrap
 * onto a second line (then shorten with an ellipsis) rather than lose their end.
 */
export function categoryLabels(labels: readonly string[], rows: Rows, axisX: number, maxWidth: number, theme: Theme): El[] {
  const size = theme.size.tick;
  const twoLines = rows.pitch >= size * LABEL_LEADING * 2 + 2;
  const out: El[] = [];
  labels.forEach((l, i) => {
    const lines = twoLines ? wrapText(l, maxWidth, size, 2) : [fitText(l, maxWidth, size)];
    const base = centreBaseline(rows.centre(i), size) - ((lines.length - 1) * size * LABEL_LEADING) / 2;
    lines.forEach((ln, j) => out.push(text(axisX - LABEL_GAP - 0.5, base + j * size * LABEL_LEADING, ln, theme, { anchor: "end" })));
  });
  return out;
}

/** Width the row labels need, capped at `cap`. */
export function categoryLabelWidth(labels: readonly string[], cap: number, theme: Theme): number {
  return Math.min(cap, Math.max(0, ...labels.map((l) => textWidth(l.replace(/\s+/g, " ").trim(), theme.size.tick)))) + LABEL_GAP + 0.5;
}

// ── Legend key ─────────────────────────────────────────────────────────────────

export interface LegendItem {
  label: string;
  swatch: "line" | "box" | "point" | "rule";
  colour: string;
  dash?: string | null;
}

const SWATCH_W: Record<LegendItem["swatch"], number> = { line: 8, rule: 8, box: 4.2, point: 4 };
const SWATCH_GAP = 2;
const ITEM_GAP = 6;

function itemWidth(item: LegendItem, theme: Theme): number {
  return SWATCH_W[item.swatch] + SWATCH_GAP + textWidth(item.label, theme.size.legend);
}

/** Items laid into rows no wider than `maxWidth`. */
export function legendRows(items: readonly LegendItem[], maxWidth: number, theme: Theme): LegendItem[][] {
  const rows: LegendItem[][] = [];
  let row: LegendItem[] = [];
  let width = 0;
  for (const it of items) {
    const w = itemWidth(it, theme);
    if (row.length && width + ITEM_GAP + w > maxWidth) {
      rows.push(row);
      row = [];
      width = 0;
    }
    width += (row.length ? ITEM_GAP : 0) + w;
    row.push(it);
  }
  if (row.length) rows.push(row);
  return rows;
}

export function topFor(rows: readonly LegendItem[][]): number {
  return TOP + Math.max(0, rows.length - 1) * LEGEND_LINE;
}

/** The key, starting at `x`, on the panel letter's baseline. */
export function drawLegend(rows: readonly LegendItem[][], x: number, box: Box, theme: Theme): El[] {
  const out: El[] = [];
  rows.forEach((row, r) => {
    const baseline = box.y + theme.size.panel * CAP_HEIGHT + r * LEGEND_LINE;
    const mid = baseline - (theme.size.legend * CAP_HEIGHT) / 2;
    let cx = x;
    for (const it of row) {
      const w = SWATCH_W[it.swatch];
      if (it.swatch === "line" || it.swatch === "rule") {
        out.push(line(cx, mid, cx + w, mid, it.colour, it.swatch === "rule" ? theme.stroke.reference : theme.stroke.line, it.dash));
      } else if (it.swatch === "box") {
        out.push(el("rect", { x: cx, y: mid - w / 2, width: w, height: w, fill: it.colour }));
      } else {
        out.push(el("circle", { cx: cx + w / 2, cy: mid, r: theme.pointRadius, fill: it.colour }));
      }
      cx += w + SWATCH_GAP;
      out.push(text(cx, baseline, it.label, theme, { size: theme.size.legend }));
      cx += textWidth(it.label, theme.size.legend) + ITEM_GAP;
    }
  });
  return out;
}

/** A horizontal bar from x0 to x1 centred on `cy`. */
export function hbar(x0: number, x1: number, cy: number, thickness: number, fill: string): El | null {
  const w = x1 - x0;
  if (!(w > 0.01)) return null;
  return el("rect", { x: x0, y: cy - thickness / 2, width: w, height: thickness, fill });
}

export function vbar(cx: number, y0: number, y1: number, thickness: number, fill: string): El | null {
  const h = y0 - y1;
  if (!(h > 0.01)) return null;
  return el("rect", { x: cx - thickness / 2, y: y1, width: thickness, height: h, fill });
}
