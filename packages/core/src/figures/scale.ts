/** Scales, tick selection and number formatting for figures. */

export type Scale = (v: number) => number;

export function linear(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** A "nice" step (1, 2, 2.5 or 5 × 10ⁿ) giving roughly `target` intervals. */
export function niceStep(range: number, target: number): number {
  const raw = Math.max(range, Number.EPSILON) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

export interface Ticks {
  min: number;
  max: number;
  step: number;
  values: number[];
}

/** Ticks covering [min, max]; counts get whole-number steps. */
export function niceTicks(min: number, max: number, target = 5, integer = false): Ticks {
  if (!(max > min)) max = min + (integer ? 1 : 1);
  let step = niceStep(max - min, target);
  if (integer && !Number.isInteger(step)) step = Math.max(1, Math.ceil(step));
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const values: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 1e9) / 1e9);
  return { min: lo, max: hi, step, values };
}

/** The percentage axis every proportion panel shares. */
export const PERCENT_TICKS: Ticks = { min: 0, max: 100, step: 25, values: [0, 25, 50, 75, 100] };

const MINUS = "−";

/**
 * Numbers as journals set them: a true minus sign, thousands separated by
 * commas from 1,000, and no more decimals than the step needs.
 */
export function formatNumber(v: number, decimals = 0): string {
  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int!.length >= 4 ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int!;
  const s = frac ? `${grouped}.${frac}` : grouped;
  return v < 0 && Number(fixed) !== 0 ? `${MINUS}${s}` : s;
}

/** Decimals a tick step needs: 2.5 → 1, 0.25 → 2, 5 → 0. */
export function decimalsFor(step: number): number {
  if (!(step > 0)) return 0;
  for (let d = 0; d < 4; d += 1) {
    const scaled = step * 10 ** d;
    if (Math.abs(Math.round(scaled) - scaled) < 1e-9) return d;
  }
  return 4;
}

export function formatPercent(p: number | null, decimals = 0): string {
  return p === null ? "–" : `${formatNumber(p * 100, decimals)}%`;
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Days since 1970-01-01 for a `YYYY-MM-DD` key. */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

export function dayFromNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** "3 Sep 2026" */
export function formatDay(day: string, withYear = true): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]}${withYear ? ` ${y}` : ""}`;
}

export interface DateTick {
  day: number;
  label: string;
}

/**
 * Candidate date tick sets from fine to coarse. The caller takes the first
 * whose labels fit without touching.
 */
export function dateTickCandidates(first: number, last: number): DateTick[][] {
  const out: DateTick[][] = [];
  const years = new Set<number>();
  for (let d = first; d <= last; d += 28) years.add(new Date(d * 86_400_000).getUTCFullYear());
  years.add(new Date(last * 86_400_000).getUTCFullYear());
  const multiYear = years.size > 1;
  const dayLabel = (d: number) => formatDay(dayFromNumber(d), false);
  for (const every of [1, 2, 7, 14]) {
    const set: DateTick[] = [];
    for (let d = first; d <= last; d += every) set.push({ day: d, label: dayLabel(d) });
    out.push(set);
  }
  for (const months of [1, 2, 3, 6, 12]) {
    const set: DateTick[] = [];
    const start = new Date(first * 86_400_000);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + (start.getUTCDate() === 1 ? 0 : 1);
    for (;;) {
      y += Math.floor(m / 12);
      m %= 12;
      const d = Date.UTC(y, m, 1) / 86_400_000;
      if (d > last) break;
      if (m % months === 0 || months === 1) {
        set.push({ day: d, label: months === 12 ? String(y) : multiYear || m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m]! });
      }
      m += 1;
    }
    if (set.length >= 2) out.push(set);
  }
  return out;
}
