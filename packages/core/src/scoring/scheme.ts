import { z } from "zod";

/**
 * A scoring scheme: how one instrument's answers become scores, what the
 * scores mean (threshold bands) and what to compare them with (benchmarks).
 *
 * Schemes are plain JSON so they can be stored, edited by an administrator,
 * versioned, and shown in full to anyone reading a result. The dashboard ships
 * defaults (schemes.ts); a study's edits are saved as new versions of the same
 * key and every score records the version it came from.
 *
 * Scores never replace answers: they are derived on demand from the stored
 * responses, so changing a scheme re-derives every score and loses nothing.
 */

/** How the scoring method relates to the instrument's published scoring. */
export const SCHEME_STATUSES = ["official", "adapted", "study"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];
export const SCHEME_STATUS_LABELS: Record<SchemeStatus, string> = {
  official: "Official method",
  adapted: "Official method, adapted form",
  study: "Study-defined summary",
};
export const SCHEME_STATUS_HELP: Record<SchemeStatus, string> = {
  official: "Scored as the instrument's authors publish it.",
  adapted: "The published method, applied to a shortened or modified version of the instrument; not directly comparable with published norms.",
  study: "No published scoring exists; a reasonable summary defined for this study. Compare within the study, not with other studies.",
};

/** Where a set of cut-points comes from. */
export const THRESHOLD_BASES = ["published", "convention", "study"] as const;
export type ThresholdBasis = (typeof THRESHOLD_BASES)[number];
export const THRESHOLD_BASIS_LABELS: Record<ThresholdBasis, string> = {
  published: "Published cut-points",
  convention: "Common research convention",
  study: "Set by this study",
};

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower-case letters, digits and _ only, starting with a letter");
const itemKey = z.string().min(1).max(80);
const text = (max: number) => z.string().trim().max(max);

/**
 * One band of a threshold set. Bands are listed from the lowest score up; a
 * score falls in the first band whose `max` it does not exceed. The last band
 * has no `max`. `level` is how much concern the band signals (0 none … 3 most);
 * null for descriptive bands such as handedness.
 */
export const scoreBand = z.object({
  label: text(80).min(1),
  max: z.number().nullable(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  /** The range as the source writes it ("−60 to 60"), where that reads better than one worked out from the limits. */
  display: text(40).optional(),
});
export type ScoreBand = z.infer<typeof scoreBand>;

export const thresholdSet = z
  .object({
    key,
    label: text(120).min(1),
    basis: z.enum(THRESHOLD_BASES),
    source: text(600),
    /** A researcher has checked the cut-points against the source document. */
    verified: z.boolean().default(false),
    note: text(600).optional(),
    bands: z.array(scoreBand).min(2).max(8),
    /**
     * Shares expected in the reference population, one per band, when the
     * cut-points were set to give them (the SDQ's four bands: 80/10/5/5).
     */
    expected: z.array(z.number().min(0).max(1)).optional(),
  })
  .superRefine((t, ctx) => {
    t.bands.forEach((b, i) => {
      const last = i === t.bands.length - 1;
      if (last && b.max !== null) ctx.addIssue({ code: "custom", path: ["bands", i, "max"], message: "the last band has no upper limit" });
      if (!last && b.max === null) ctx.addIssue({ code: "custom", path: ["bands", i, "max"], message: "only the last band may be open-ended" });
      const prev = t.bands[i - 1]?.max;
      if (i > 0 && b.max !== null && prev !== null && prev !== undefined && b.max <= prev) {
        ctx.addIssue({ code: "custom", path: ["bands", i, "max"], message: "upper limits must increase from band to band" });
      }
    });
    if (t.expected) {
      if (t.expected.length !== t.bands.length) ctx.addIssue({ code: "custom", path: ["expected"], message: "give one expected share per band" });
      const sum = t.expected.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.011) ctx.addIssue({ code: "custom", path: ["expected"], message: "expected shares must add up to 100%" });
    }
  });
export type ThresholdSet = z.infer<typeof thresholdSet>;

/** A reference population to compare against: its mean and spread. */
export const scoreBenchmark = z.object({
  key,
  label: text(120).min(1),
  population: text(300),
  source: text(600),
  verified: z.boolean().default(false),
  mean: z.number(),
  sd: z.number().positive().nullable(),
  n: z.number().int().positive().nullable().default(null),
});
export type ScoreBenchmark = z.infer<typeof scoreBenchmark>;

const items = z.array(itemKey).min(1).max(60);

/** How an output is calculated. Outputs may use outputs listed before them. */
export const scoreCalc = z.discriminatedUnion("op", [
  /** Sum of items. With `prorate`, a sum from at least `minValid` items is scaled up to the full length and rounded (the SDQ rule). */
  z.object({ op: z.literal("sum"), items, minValid: z.number().int().min(1), prorate: z.boolean().default(false) }),
  /** Mean of the items answered, if at least `minValid` were. */
  z.object({ op: z.literal("mean"), items, minValid: z.number().int().min(1) }),
  /** One item's value, as it stands after any transforms. */
  z.object({ op: z.literal("item"), item: itemKey }),
  /** Earlier outputs combined: all of them must be present. `difference` is the first minus the second. */
  z.object({
    op: z.literal("combine"),
    outputs: z.array(key).min(1).max(10),
    how: z.enum(["sum", "mean", "difference"]),
    weights: z.array(z.number()).optional(),
  }),
  /** An earlier output looked up in a published conversion table (keys are the input values). */
  z.object({ op: z.literal("convert"), output: key, table: z.record(z.string(), z.number()) }),
]);
export type ScoreCalc = z.infer<typeof scoreCalc>;

export const HIGHER_IS = ["better", "worse", "neutral"] as const;

export const scoreOutput = z.object({
  key,
  label: text(120).min(1),
  description: text(600).optional(),
  calc: scoreCalc,
  range: z.tuple([z.number(), z.number()]),
  /** Places shown; values are kept unrounded. */
  decimals: z.number().int().min(0).max(3).default(0),
  higherIs: z.enum(HIGHER_IS),
  /** The score to show first for the instrument. */
  primary: z.boolean().default(false),
  thresholds: z.array(thresholdSet).max(6).default([]),
  benchmarks: z.array(scoreBenchmark).max(10).default([]),
});
export type ScoreOutput = z.infer<typeof scoreOutput>;

/** Changes to item values before any output is calculated. */
export const itemTransform = z.discriminatedUnion("op", [
  /** x → maxPlusMin − x (a 0–2 item reversed with 2; a 1–4 item with 5). */
  z.object({ op: z.literal("reverse"), items, maxPlusMin: z.number() }),
  /** Codes mapped to values; a code mapped to null, or not listed, becomes missing. */
  z.object({ op: z.literal("recode"), items, map: z.record(z.string(), z.number().nullable()) }),
]);
export type ItemTransform = z.infer<typeof itemTransform>;

export const scoringScheme = z
  .object({
    /** Stable identifier; the instrument id unless a study keeps two schemes for one instrument. */
    key,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "a version like 1.2.0"),
    /** The instrument id in the survey's releases. */
    instrument: z.string().min(1).max(80),
    name: text(160).min(1),
    abbreviation: text(40).optional(),
    status: z.enum(SCHEME_STATUSES),
    /** How it is scored and on whose authority, in a sentence or two, with the citation. */
    method: text(1200).min(1),
    notes: text(2000).optional(),
    /** Who confirmed the scheme against the licensed scoring documentation, and when. */
    verified: z.object({ by: z.string().min(1), at: z.string().min(1), note: text(600).optional() }).nullable().default(null),
    transforms: z.array(itemTransform).max(20).default([]),
    outputs: z.array(scoreOutput).min(1).max(20),
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.outputs.forEach((o, i) => {
      if (seen.has(o.key)) ctx.addIssue({ code: "custom", path: ["outputs", i, "key"], message: `the output "${o.key}" is defined twice` });
      const refs = o.calc.op === "combine" ? o.calc.outputs : o.calc.op === "convert" ? [o.calc.output] : [];
      for (const r of refs) if (!seen.has(r)) ctx.addIssue({ code: "custom", path: ["outputs", i, "calc"], message: `"${r}" must be an output listed before "${o.key}"` });
      if (o.calc.op === "combine") {
        if (o.calc.how === "difference" && o.calc.outputs.length !== 2) ctx.addIssue({ code: "custom", path: ["outputs", i, "calc"], message: "a difference needs exactly two outputs" });
        if (o.calc.weights && o.calc.weights.length !== o.calc.outputs.length) ctx.addIssue({ code: "custom", path: ["outputs", i, "calc", "weights"], message: "give one weight per output" });
      }
      if ((o.calc.op === "sum" || o.calc.op === "mean") && o.calc.minValid > o.calc.items.length) {
        ctx.addIssue({ code: "custom", path: ["outputs", i, "calc", "minValid"], message: "cannot require more items than the score has" });
      }
      if (o.calc.op === "sum" && !o.calc.prorate && o.calc.minValid !== o.calc.items.length) {
        ctx.addIssue({ code: "custom", path: ["outputs", i, "calc", "minValid"], message: `a sum without proration needs every item: set minValid to ${o.calc.items.length}, turn proration on, or use a mean` });
      }
      if (o.range[0] >= o.range[1]) ctx.addIssue({ code: "custom", path: ["outputs", i, "range"], message: "the range must run from low to high" });
      const keys = new Set<string>();
      for (const t of [...o.thresholds, ...o.benchmarks]) {
        if (keys.has(t.key)) ctx.addIssue({ code: "custom", path: ["outputs", i], message: `"${t.key}" is used twice` });
        keys.add(t.key);
      }
      seen.add(o.key);
    });
  });
export type ScoringScheme = z.infer<typeof scoringScheme>;
export type ScoringSchemeInput = z.input<typeof scoringScheme>;

/** A scheme from storage or an editor, or the reasons it cannot be used. */
export function parseScheme(raw: unknown): { scheme: ScoringScheme } | { errors: string[] } {
  const r = scoringScheme.safeParse(raw);
  if (r.success) return { scheme: r.data };
  return { errors: r.error.issues.map((i) => `${i.path.join(".") || "scheme"}: ${i.message}`) };
}
