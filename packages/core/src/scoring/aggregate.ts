import { quantile } from "../analytics.js";
import { wilson } from "../figures/stats.js";
import type { ScoreOutput } from "./scheme.js";

/**
 * Score summaries for a set of sittings: the distribution, mean with a 95%
 * interval, and how many fall in each threshold band (with Wilson intervals).
 * Aggregates only — no row that could be traced to a participant leaves here.
 */

export interface ScoreRow {
  value: number | null;
  bands: Record<string, number | null>;
}

export interface BandShare {
  count: number;
  share: number;
  lo: number;
  hi: number;
}

export interface ScoreSummary {
  /** Sittings with a score. */
  n: number;
  /** Sittings in the group without one (instrument missing or too few items). */
  missing: number;
  mean: number;
  sd: number | null;
  ci: [number, number] | null;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  /** Per threshold set, the sittings in each band. */
  bands: Record<string, BandShare[]>;
  histogram?: { from: number; to: number; count: number }[];
}

/** t(0.975) for 1–30 degrees of freedom, from standard tables. */
const T_TABLE = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Two-sided 95% t quantile: tabled up to 30 degrees of freedom (interpolated for Welch's fractional df), a Cornish–Fisher expansion beyond. */
export function t975(df: number): number {
  if (!(df >= 1)) return df > 0 ? T_TABLE[0]! : NaN;
  if (df <= 30) {
    const lo = Math.floor(df);
    const hi = Math.ceil(df);
    const a = T_TABLE[lo - 1]!;
    const b = T_TABLE[hi - 1]!;
    return a + (b - a) * (df - lo);
  }
  const z = 1.959963984540054;
  const z3 = z ** 3;
  const z5 = z ** 5;
  const z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}

/** Bins for a distribution: one per whole value on short whole-number scales, else 20 even bins over the range. */
export function binsFor(output: Pick<ScoreOutput, "range" | "decimals">): { from: number; to: number }[] {
  const [lo, hi] = output.range;
  if (output.decimals === 0 && Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 40) {
    return Array.from({ length: hi - lo + 1 }, (_, i) => ({ from: lo + i, to: lo + i }));
  }
  const w = (hi - lo) / 20;
  return Array.from({ length: 20 }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w }));
}

export function summarise(rows: readonly ScoreRow[], output: ScoreOutput, options: { histogram?: boolean } = {}): ScoreSummary | null {
  const scored = rows.filter((r): r is ScoreRow & { value: number } => r.value !== null && Number.isFinite(r.value));
  const n = scored.length;
  if (n === 0) return null;
  const values = scored.map((r) => r.value).sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
  const half = sd !== null ? (t975(n - 1) * sd) / Math.sqrt(n) : null;
  const bands: Record<string, BandShare[]> = {};
  for (const t of output.thresholds) {
    const counts = t.bands.map(() => 0);
    for (const r of scored) {
      const i = r.bands[t.key];
      if (i !== null && i !== undefined) counts[i]! += 1;
    }
    bands[t.key] = counts.map((count) => {
      const w = wilson(count, n)!;
      return { count, share: count / n, lo: w.lo, hi: w.hi };
    });
  }
  const summary: ScoreSummary = {
    n,
    missing: rows.length - n,
    mean,
    sd,
    ci: half === null ? null : [mean - half, mean + half],
    median: quantile(values, 0.5),
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75),
    min: values[0]!,
    max: values[n - 1]!,
    bands,
  };
  if (options.histogram) {
    const bins = binsFor(output);
    const whole = bins.every((b) => b.from === b.to);
    const counts = bins.map(() => 0);
    for (const v of values) {
      let i = whole ? Math.round(v) - bins[0]!.from : Math.floor((v - bins[0]!.from) / (bins[0]!.to - bins[0]!.from));
      i = Math.max(0, Math.min(bins.length - 1, i));
      counts[i]! += 1;
    }
    summary.histogram = bins.map((b, i) => ({ ...b, count: counts[i]! }));
  }
  return summary;
}

/**
 * A group against a comparison (the rest of the study, or a benchmark):
 * the difference in means with a Welch 95% interval, and the difference in
 * reference standard deviations (a standardised effect, Cohen's d style).
 */
export interface Comparison {
  difference: number;
  ci: [number, number] | null;
  /** Difference in units of the comparison's SD (a benchmark's published SD, or the pooled SD). */
  standardised: number | null;
}

export function compareToGroup(a: ScoreSummary, b: ScoreSummary): Comparison {
  const difference = a.mean - b.mean;
  let ci: [number, number] | null = null;
  if (a.sd !== null && b.sd !== null && a.n > 1 && b.n > 1) {
    const va = a.sd ** 2 / a.n;
    const vb = b.sd ** 2 / b.n;
    const se = Math.sqrt(va + vb);
    const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
    const half = t975(df) * se;
    ci = [difference - half, difference + half];
  }
  const pooled =
    a.sd !== null && b.sd !== null && a.n + b.n > 2 ? Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2)) : null;
  return { difference, ci, standardised: pooled ? difference / pooled : null };
}

export function compareToBenchmark(a: ScoreSummary, benchmark: { mean: number; sd: number | null }): Comparison {
  const difference = a.mean - benchmark.mean;
  const ci: [number, number] | null = a.ci ? [a.ci[0] - benchmark.mean, a.ci[1] - benchmark.mean] : null;
  return { difference, ci, standardised: benchmark.sd ? difference / benchmark.sd : null };
}

/** Which sittings stand for each participant. */
export const OBSERVATIONS = ["latest", "first", "all", "wave_1", "wave_2", "wave_3"] as const;
export type Observation = (typeof OBSERVATIONS)[number];
export const OBSERVATION_LABELS: Record<Observation, string> = {
  latest: "Each participant's latest sitting",
  first: "Each participant's first sitting",
  all: "Every sitting",
  wave_1: "Wave 1 sittings",
  wave_2: "Wave 2 sittings",
  wave_3: "Wave 3 sittings",
};

export function pickObservations<T extends { participantId: string; wave: number }>(rows: readonly T[], observation: Observation): T[] {
  if (observation === "all") return [...rows];
  if (observation.startsWith("wave_")) {
    const w = Number(observation.slice(5));
    return rows.filter((r) => r.wave === w);
  }
  const best = new Map<string, T>();
  for (const r of rows) {
    const cur = best.get(r.participantId);
    if (!cur || (observation === "latest" ? r.wave > cur.wave : r.wave < cur.wave)) best.set(r.participantId, r);
  }
  return [...best.values()];
}
