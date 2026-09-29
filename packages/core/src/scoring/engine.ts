import type { ScoreOutput, ScoringScheme, ThresholdSet } from "./scheme.js";

/**
 * Applies a scheme to one sitting's answers. Item values are the stored codes
 * (null when the item was not answered, whatever the reason); nothing is
 * mutated and nothing is guessed: a score that its rules cannot support is
 * null, with the number of items that were available.
 */

export type ItemValues = Readonly<Record<string, number | null | undefined>>;

export interface ScoreValue {
  value: number | null;
  /** Items answered, and items the score is built from (null for scores built from other scores). */
  valid: number | null;
  of: number | null;
  /** The band each threshold set puts the score in (index into its bands), by set key. */
  bands: Record<string, number | null>;
}

export interface SchemeScores {
  scheme: string;
  version: string;
  outputs: Record<string, ScoreValue>;
}

export function applyScheme(scheme: ScoringScheme, answers: ItemValues): SchemeScores {
  const items = new Map<string, number | null>();
  const read = (k: string) => (items.has(k) ? items.get(k)! : (answers[k] ?? null));
  for (const t of scheme.transforms) {
    for (const k of t.items) {
      const v = read(k);
      if (v === null) {
        items.set(k, null);
        continue;
      }
      if (t.op === "reverse") items.set(k, t.maxPlusMin - v);
      else {
        const mapped = t.map[String(v)];
        items.set(k, mapped === undefined ? null : mapped);
      }
    }
  }

  const outputs: Record<string, ScoreValue> = {};
  for (const o of scheme.outputs) {
    const { value, valid, of } = calculate(o, read, outputs);
    outputs[o.key] = { value, valid, of, bands: Object.fromEntries(o.thresholds.map((t) => [t.key, value === null ? null : bandIndex(t, value)])) };
  }
  return { scheme: scheme.key, version: scheme.version, outputs };
}

function calculate(o: ScoreOutput, read: (k: string) => number | null, done: Record<string, ScoreValue>): { value: number | null; valid: number | null; of: number | null } {
  const c = o.calc;
  switch (c.op) {
    case "sum":
    case "mean": {
      const values = c.items.map(read).filter((v): v is number => v !== null && Number.isFinite(v));
      const base = { valid: values.length, of: c.items.length };
      if (values.length < c.minValid) return { value: null, ...base };
      const total = values.reduce((a, b) => a + b, 0);
      if (c.op === "mean") return { value: total / values.length, ...base };
      if (values.length === c.items.length) return { value: total, ...base };
      // Proration: the mean of the items answered, scaled to the full length and rounded.
      return { value: c.prorate ? Math.round((total / values.length) * c.items.length) : null, ...base };
    }
    case "item": {
      const v = read(c.item);
      return { value: v, valid: v === null ? 0 : 1, of: 1 };
    }
    case "combine": {
      const values = c.outputs.map((k) => done[k]?.value ?? null);
      if (values.some((v) => v === null)) return { value: null, valid: null, of: null };
      const w = c.weights ?? values.map(() => 1);
      const vs = values as number[];
      if (c.how === "difference") return { value: w[0]! * vs[0]! - w[1]! * vs[1]!, valid: null, of: null };
      const sum = vs.reduce((a, v, i) => a + w[i]! * v, 0);
      return { value: c.how === "mean" ? sum / vs.length : sum, valid: null, of: null };
    }
    case "convert": {
      const v = done[c.output]?.value ?? null;
      if (v === null) return { value: null, valid: null, of: null };
      const mapped = c.table[String(v)];
      return { value: mapped === undefined ? null : mapped, valid: null, of: null };
    }
  }
}

/** The band a value falls in: the first whose upper limit it does not exceed. */
export function bandIndex(set: ThresholdSet, value: number): number {
  const i = set.bands.findIndex((b) => b.max === null || value <= b.max + 1e-9);
  return i === -1 ? set.bands.length - 1 : i;
}

/**
 * "0–14", "15–17", "20–40" for whole-number scores; "below 17.5", "17.5 to
 * 20.5", "27.5 and above" for continuous ones.
 */
export function bandRange(set: ThresholdSet, index: number, output: Pick<ScoreOutput, "range" | "decimals">): string {
  const band = set.bands[index]!;
  if (band.display) return band.display;
  const prev = index > 0 ? set.bands[index - 1]!.max : null;
  const [lo, hi] = output.range;
  const whole = output.decimals === 0 && set.bands.every((b) => b.max === null || Number.isInteger(b.max)) && Number.isInteger(lo) && Number.isInteger(hi);
  const f = (n: number) => String(Number(n.toFixed(3))).replace("-", "−");
  if (whole) {
    const from = prev === null ? lo : prev + 1;
    const to = band.max === null ? hi : band.max;
    return from === to ? f(from) : `${f(from)}–${f(to)}`;
  }
  if (prev === null) return `up to ${f(band.max!)}`;
  if (band.max === null) return `above ${f(prev)}`;
  return `${f(prev)}–${f(band.max)}`;
}
