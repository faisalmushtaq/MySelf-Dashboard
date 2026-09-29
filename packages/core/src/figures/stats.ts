/** Statistics drawn in figures. */

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion k/n. Unlike the Wald
 * interval it stays inside [0, 1] and behaves at small n and at 0% or 100%,
 * which is where completion rates for small groups sit.
 */
export function wilson(k: number, total: number, z = Z95): Interval | null {
  if (!(total > 0) || k < 0 || k > total) return null;
  const p = k / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  // At 0% and 100% the interval touches the bound exactly (not 1 − ε).
  return { p, lo: k === 0 ? 0 : Math.max(0, centre - half), hi: k === total ? 1 : Math.min(1, centre + half) };
}
