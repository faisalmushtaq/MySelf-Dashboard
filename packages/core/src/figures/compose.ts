import { csvRow } from "../csv.js";
import { OBSERVATION_LABELS } from "../scoring/aggregate.js";
import { formatNumber } from "./scale.js";
import { el, render, type El } from "./svg.js";
import { panelLetter } from "./draw.js";
import { PANELS, PANEL_NAMES } from "./panels.js";
import { FIGURE_WIDTHS, MAX_HEIGHT_MM, PT_PER_MM, themeFor, type FigureWidth } from "./theme.js";
import type { FigureContext, FigureSpec, PanelBuilder, PanelKind, PanelOutput, PanelSpec, SourceTable } from "./types.js";

/**
 * Lays panels out on the journal page, letters them, and assembles the figure
 * legend, the source data and the finished SVG.
 */

const COL_GAP = 12;
const ROW_GAP = 10;
const LETTERS = "abcdef";

export interface FigureResult {
  svg: string;
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
  /** "Fig. 1 | Title. a, … b, …" — the legend a journal prints under the figure. */
  legend: string;
  /** The same content as one sentence per panel, for screen readers. */
  description: string;
  source: SourceTable[];
  warnings: string[];
  panels: { letter: string; kind: PanelKind; name: string }[];
}

export function columnsFor(width: FigureWidth, count: number): number {
  if (count <= 1 || width === "single") return 1;
  if (width === "onehalf") return 2;
  return count === 2 || count === 4 ? 2 : 3;
}

function builderFor(p: PanelSpec): PanelBuilder<PanelKind> {
  return PANELS[p.kind] as unknown as PanelBuilder<PanelKind>;
}

const COMPLETENESS_PANELS: ReadonlySet<PanelKind> = new Set(["status", "completion", "sections", "items"]);

export function composeFigure(spec: FigureSpec, ctx: FigureContext, options: { createdAt?: string } = {}): FigureResult {
  const theme = themeFor(spec.colour);
  const widthMm = FIGURE_WIDTHS[spec.width].mm;
  const W = widthMm * PT_PER_MM;
  const cols = columnsFor(spec.width, spec.panels.length);
  const colW = (W - COL_GAP * (cols - 1)) / cols;
  const lettered = spec.panels.length > 1;

  const rows: PanelSpec[][] = [];
  for (let i = 0; i < spec.panels.length; i += cols) rows.push(spec.panels.slice(i, i + cols));
  const heights = rows.map((row) => Math.max(...row.map((p) => builderFor(p).preferredHeight(p, ctx, colW, theme))));
  const H = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1);

  const groups: El[] = [];
  const outputs: { letter: string; spec: PanelSpec; out: PanelOutput }[] = [];
  let y = 0;
  rows.forEach((row, r) => {
    row.forEach((p, c) => {
      const index = r * cols + c;
      const letter = LETTERS[index]!;
      const box = { x: c * (colW + COL_GAP), y, width: colW, height: heights[r]! };
      const out = builderFor(p).render(p, ctx, box, theme);
      outputs.push({ letter, spec: p, out });
      groups.push(el("g", { id: `panel-${letter}` }, lettered ? panelLetter(letter, box, theme) : null, ...out.body));
    });
    y += heights[r]! + ROW_GAP;
  });

  const heightMm = H / PT_PER_MM;
  const title = spec.title.trim().replace(/\.$/, "");
  const panelSentences = outputs.map((o) => (lettered ? `${o.letter}, ${o.out.legend}` : o.out.legend));
  const scoresOnly = spec.panels.every((p) => p.kind.startsWith("score_"));
  const sessions = scoresOnly ? (ctx.scores?.counts.sittings ?? 0) : (ctx.analytics?.metrics.started ?? 0);
  const who = scoresOnly && ctx.scores
    ? `${formatNumber(ctx.scores.counts.sittings)} sitting${ctx.scores.counts.sittings === 1 ? "" : "s"} from ${formatNumber(ctx.scores.counts.participants)} participant${ctx.scores.counts.participants === 1 ? "" : "s"} (${OBSERVATION_LABELS[ctx.scores.observation].toLowerCase()})`
    : `${formatNumber(sessions)} session${sessions === 1 ? "" : "s"}`;
  const dataSentence = `Data: ${who}, ${ctx.period}` + (ctx.filters.length ? `; ${ctx.filters.join("; ")}` : "") + ".";
  const notes = [...new Set(outputs.flatMap((o) => o.out.notes))];
  if (outputs.some((o) => COMPLETENESS_PANELS.has(o.spec.kind))) {
    notes.push(`Completeness is judged against the survey version each participant received (dashboard rules ${ctx.rulesVersion}).`);
  }
  const legend = [`Fig. ${spec.number} | ${title}.`, ...panelSentences, dataSentence, ...notes].join(" ");
  const description = [`Figure ${spec.number}: ${title}.`, ...outputs.map((o) => `${lettered ? `Panel ${o.letter}: ` : ""}${o.out.legend}`)].join(" ");

  const svgEl = el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      version: "1.1",
      width: `${Math.round(widthMm * 100) / 100}mm`,
      height: `${Math.round(heightMm * 100) / 100}mm`,
      viewBox: `0 0 ${Math.round(W * 100) / 100} ${Math.round(H * 100) / 100}`,
      "font-family": theme.font,
    },
    el("title", {}, `Fig. ${spec.number} | ${title}`),
    el("desc", {}, description),
    ...groups,
  );

  const warnings = outputs.flatMap((o) => o.out.warnings);
  if (heightMm > MAX_HEIGHT_MM) {
    warnings.push(`The figure is ${Math.round(heightMm)} mm tall, deeper than a journal page (${MAX_HEIGHT_MM} mm). Use fewer panels, fewer questions, or a wider layout.`);
  }

  const source: SourceTable[] = [
    {
      panel: "",
      title: "Figure",
      columns: ["Field", "Value"],
      rows: [
        ["Figure", `Fig. ${spec.number}`],
        ["Title", title],
        ["Data", `${sessions} sessions, ${ctx.period}`],
        ["Filters", ctx.filters.join("; ") || "None"],
        ["Completeness rules", ctx.rulesVersion],
        ["Width", FIGURE_WIDTHS[spec.width].label],
        ...(options.createdAt ? ([["Created", options.createdAt]] as [string, string][]) : []),
      ],
    },
    ...outputs.map((o) => ({ panel: lettered ? o.letter : "", ...o.out.source })),
  ];

  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${render(svgEl)}\n`,
    widthMm,
    heightMm,
    widthPt: W,
    heightPt: H,
    legend,
    description,
    source,
    warnings,
    panels: outputs.map((o) => ({ letter: lettered ? o.letter : "", kind: o.spec.kind, name: PANEL_NAMES[o.spec.kind] })),
  };
}

/**
 * Source data as one CSV: a titled block per panel, as journals ask for with
 * each figure. Cells go through the same formula-neutralising writer as every
 * other export.
 */
export function sourceDataCsv(result: FigureResult): string {
  const blocks = result.source.map((t) => {
    const head = csvRow([t.panel ? `Panel ${t.panel}: ${t.title}` : t.title]);
    return [head, csvRow(t.columns), ...t.rows.map((r) => csvRow(r))].join("\r\n");
  });
  return `﻿${blocks.join("\r\n\r\n")}\r\n`;
}
