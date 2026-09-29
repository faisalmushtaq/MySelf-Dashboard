import { z } from "zod";
import type { Analytics } from "../analytics.js";
import type { ScoresView } from "../scoring/benchmark.js";
import type { QuestionStat } from "../questions.js";
import type { El } from "./svg.js";
import type { Theme } from "./theme.js";

/**
 * A figure is a list of panels plus page settings. It holds no data — only which
 * aggregate to draw and how — so it can be kept in the browser and reused as the
 * filters change.
 */

export const PANEL_KINDS = ["participation", "status", "completion", "sections", "items", "responses", "duration", "score_distribution", "score_groups", "score_bands"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

const hash = z.string().max(80);

export const panelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("participation"), cumulative: z.boolean().default(true) }),
  z.object({ kind: z.literal("status") }),
  z.object({
    kind: z.literal("completion"),
    group: z.enum(["version", "site"]).default("version"),
    siteLabels: z.enum(["anonymised", "codes"]).default("anonymised"),
  }),
  z.object({ kind: z.literal("sections"), measure: z.enum(["reached", "completion"]).default("reached") }),
  z.object({
    kind: z.literal("items"),
    version: hash.default(""),
    section: z.string().max(160).nullable().default(null),
    requiredOnly: z.boolean().default(true),
    order: z.enum(["questionnaire", "lowest"]).default("lowest"),
    limit: z.number().int().min(3).max(40).default(12),
    labels: z.enum(["text", "variable"]).default("text"),
  }),
  z.object({ kind: z.literal("responses"), version: hash.default(""), question: z.string().max(160).default("") }),
  z.object({ kind: z.literal("duration") }),
  /** Scores: "" picks the scheme's primary output, first threshold set or first benchmark; "none" leaves it out. */
  z.object({ kind: z.literal("score_distribution"), scheme: z.string().max(80).default(""), output: z.string().max(80).default(""), thresholds: z.string().max(80).default(""), benchmark: z.string().max(80).default("") }),
  z.object({ kind: z.literal("score_groups"), scheme: z.string().max(80).default(""), output: z.string().max(80).default(""), benchmark: z.string().max(80).default("") }),
  z.object({ kind: z.literal("score_bands"), scheme: z.string().max(80).default(""), output: z.string().max(80).default(""), thresholds: z.string().max(80).default("") }),
]);
export type PanelSpec = z.infer<typeof panelSpecSchema>;
export type PanelOf<K extends PanelKind> = Extract<PanelSpec, { kind: K }>;

export const figureSpecSchema = z.object({
  width: z.enum(["single", "onehalf", "double"]).default("double"),
  colour: z.enum(["colour", "greyscale"]).default("colour"),
  number: z.number().int().min(1).max(99).default(1),
  title: z.string().max(300).default("Participation and data completeness in the MySelf study"),
  panels: z.array(panelSpecSchema).min(1).max(6),
});
export type FigureSpec = z.infer<typeof figureSpecSchema>;

export const DEFAULT_FIGURE: FigureSpec = {
  width: "double",
  colour: "colour",
  number: 1,
  title: "Participation and data completeness in the MySelf study",
  panels: [{ kind: "participation", cumulative: true }, { kind: "completion", group: "version", siteLabels: "anonymised" }, { kind: "sections", measure: "reached" }, { kind: "duration" }],
};

/** A spec from storage or a URL: anything malformed falls back to the default. */
export function parseFigureSpec(raw: unknown): FigureSpec {
  const r = figureSpecSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_FIGURE;
}

export function defaultPanel(kind: PanelKind, version = ""): PanelSpec {
  return panelSpecSchema.parse({ kind, ...(kind === "items" || kind === "responses" ? { version } : {}) });
}

/** One survey version's question statistics, under the figure's filters. */
export interface QuestionData {
  version: string;
  sessions: number;
  stats: QuestionStat[];
}

/** Everything a figure is drawn from: aggregates only, never a participant row. */
export interface FigureContext {
  analytics: Analytics | null;
  /** Keyed by release hash. */
  questions: Record<string, QuestionData | undefined>;
  /** "1 September 2026 to 28 September 2026 (date started)" */
  period: string;
  /** Plain-language active filters, excluding the date range. */
  filters: string[];
  timeZone: string;
  rulesVersion: string;
  requiredLevels: readonly string[];
  abandonAfterHours: number;
  versionLabel: (hash: string) => string;
  /** Score summaries, for the score panels. */
  scores?: ScoresView | null;
}

export type CsvCell = string | number | null;

export interface SourceTable {
  panel: string;
  title: string;
  columns: string[];
  rows: CsvCell[][];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelOutput {
  body: El[];
  /** The panel's sentence in the figure legend, after its letter. */
  legend: string;
  /** Sentences about definitions, shared across panels and de-duplicated. */
  notes: string[];
  source: { title: string; columns: string[]; rows: CsvCell[][] };
  warnings: string[];
}

export interface PanelBuilder<K extends PanelKind> {
  /** Short name for menus and screen readers. */
  name: string;
  preferredHeight(spec: PanelOf<K>, ctx: FigureContext, width: number, theme: Theme): number;
  render(spec: PanelOf<K>, ctx: FigureContext, box: Box, theme: Theme): PanelOutput;
}
