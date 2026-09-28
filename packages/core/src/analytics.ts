import { addDays, dayKey, daysBetween, weekStart, type ResolvedRange } from "./dates.js";
import type { ReleaseIndex } from "./manifest.js";
import { compareVersions } from "./manifest.js";
import type { SessionRow } from "./filters.js";
import { DISPLAY_STATUSES, type DisplayStatus } from "./status.js";

/**
 * Overview metrics and charts, computed from summaries (never raw logs).
 * Definitions: docs/03-completeness.md §3.5.
 */

export interface OverviewMetrics {
  started: number;
  complete: number;
  incomplete: number;
  abandoned: number;
  inProgress: number;
  notStarted: number;
  needsReview: number;
  invalid: number;
  test: number;
  flagged: number;
  completionRate: number | null;
  completionRateDenominator: number;
  medianDurationMs: number | null;
  durationN: number;
  newInPeriod: number;
  latestResponseAt: string | null;
  latestReceivedAt: string | null;
  meanRequiredCompletion: number | null;
  estimatedCount: number;
  unknownVersionCount: number;
}

export interface SeriesPoint {
  bucket: string;
  started: number;
  completed: number;
  terminalOrAbandoned: number;
  completionRate: number | null;
  meanCompletion: number | null;
}

export interface SectionStat {
  key: string;
  title: string;
  sessionsApplicable: number;
  sessionsReached: number;
  sessionsWithMissing: number;
  required: number;
  resolved: number;
  completion: number | null;
}

export interface QuestionCount {
  key: string;
  text: string;
  sectionTitle: string;
  count: number;
}

export interface VersionStat {
  hash: string;
  key: string | null;
  version: string | null;
  publishedAt: string | null;
  known: boolean;
  sessions: number;
  complete: number;
  incomplete: number;
  abandoned: number;
  completionRate: number | null;
  /** Denominator and numerator of completionRate: finished, valid sessions and those complete. */
  finished: number;
  finishedComplete: number;
  meanCompletion: number | null;
  medianDurationMs: number | null;
  firstStartedAt: string | null;
  lastStartedAt: string | null;
}

export interface Analytics {
  computedAt: string;
  granularity: "day" | "week";
  metrics: OverviewMetrics;
  series: SeriesPoint[];
  statusBreakdown: { status: DisplayStatus; count: number }[];
  sections: SectionStat[];
  topMissing: QuestionCount[];
  dropOff: QuestionCount[];
  dropOffSections: { key: string; title: string; count: number }[];
  versions: VersionStat[];
  durationHistogram: { label: string; fromMin: number; toMin: number | null; count: number }[];
  signals: { code: string; count: number }[];
  sites: SiteStat[];
  /** Completion times on even bins, for figures; null below MIN_DURATION_N. */
  durationDistribution: DurationDistribution | null;
}

export interface SiteStat {
  site: string;
  count: number;
  /** Finished, valid sessions and those complete (the completion-rate fraction). */
  finished: number;
  finishedComplete: number;
}

export interface DurationDistribution {
  n: number;
  binMinutes: number;
  bins: { fromMin: number; toMin: number; count: number }[];
  /** Sessions at or beyond the last bin, reported rather than drawn. */
  overflowFromMin: number;
  overflow: number;
  medianMin: number;
  q1Min: number;
  q3Min: number;
}

/** Linear-interpolated quantile of sorted values. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Even bins up to the 95th percentile (so one very long sitting cannot squash
 * the histogram), with a width from 1–2–5 minutes giving 8–20 bars.
 */
export function durationDistributionOf(durationsMs: readonly number[]): DurationDistribution | null {
  if (durationsMs.length < MIN_DURATION_N) return null;
  const mins = durationsMs.map((d) => d / 60_000).sort((a, b) => a - b);
  const p95 = quantile(mins, 0.95);
  const widths = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const binMinutes = widths.find((w) => Math.ceil(p95 / w) <= 20) ?? 60;
  const nBins = Math.max(1, Math.ceil(Math.max(p95, binMinutes) / binMinutes));
  const cap = nBins * binMinutes;
  const bins = Array.from({ length: nBins }, (_, i) => ({ fromMin: i * binMinutes, toMin: (i + 1) * binMinutes, count: 0 }));
  let overflow = 0;
  for (const m of mins) {
    if (m >= cap) overflow += 1;
    else bins[Math.min(nBins - 1, Math.floor(m / binMinutes))]!.count += 1;
  }
  return {
    n: mins.length,
    binMinutes,
    bins,
    overflowFromMin: cap,
    overflow,
    medianMin: quantile(mins, 0.5),
    q1Min: quantile(mins, 0.25),
    q3Min: quantile(mins, 0.75),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** Minimum sample for a median completion time to be shown at all. */
export const MIN_DURATION_N = 5;

/** Question and section wording from the newest release that defines them. */
export interface Definitions {
  question: (key: string) => { text: string; sectionTitle: string } | undefined;
  section: (key: string) => string | undefined;
  sectionOrder: (key: string) => number;
  questionOrder: (key: string) => number;
}

export function definitionsFrom(releases: readonly ReleaseIndex[]): Definitions {
  const newestFirst = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  const q = new Map<string, { text: string; sectionTitle: string; order: number }>();
  const s = new Map<string, { title: string; order: number }>();
  for (const r of newestFirst) {
    for (const x of r.questions) if (!q.has(x.key)) q.set(x.key, { text: x.text, sectionTitle: x.sectionTitle, order: x.order });
    for (const x of r.sections) if (!s.has(x.key)) s.set(x.key, { title: x.title, order: x.order });
  }
  return {
    question: (key) => q.get(key),
    section: (key) => s.get(key)?.title,
    sectionOrder: (key) => s.get(key)?.order ?? 999,
    questionOrder: (key) => q.get(key)?.order ?? 99_999,
  };
}

function durationOf(row: SessionRow): number | null {
  const s = row.summary;
  // Device-measured, monotonic, and only for sittings that were never resumed
  // (a resumed sitting's timer covers only its last stretch).
  if (row.status.lifecycle !== "complete" || s.resumedCount > 0 || s.durationMs === null) return null;
  return s.durationMs;
}

const DURATION_BINS: [number, number | null][] = [
  [0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 40], [40, 50], [50, 60], [60, 90], [90, null],
];

export interface AnalyticsContext {
  now: Date;
  timeZone: string;
  range: ResolvedRange;
  releases: readonly ReleaseIndex[];
}

export function computeAnalytics(rows: readonly SessionRow[], ctx: AnalyticsContext): Analytics {
  const defs = definitionsFrom(ctx.releases);
  const tz = ctx.timeZone;

  // ── metrics ──────────────────────────────────────────────────────────────
  const counts = new Map<DisplayStatus, number>(DISPLAY_STATUSES.map((s) => [s, 0]));
  let flagged = 0;
  let newInPeriod = 0;
  let latestResponse: string | null = null;
  let latestReceived: string | null = null;
  let estimatedCount = 0;
  let unknownVersionCount = 0;
  const durations: number[] = [];
  const completions: number[] = [];
  for (const r of rows) {
    const s = r.summary;
    counts.set(r.status.lifecycle, (counts.get(r.status.lifecycle) ?? 0) + 1);
    for (const m of r.status.markers) counts.set(m, (counts.get(m) ?? 0) + 1);
    if (r.status.openFlags > 0) flagged += 1;
    if (s.firstReceivedAt) {
      const t = Date.parse(s.firstReceivedAt);
      if ((ctx.range.from === null || t >= ctx.range.from) && (ctx.range.to === null || t < ctx.range.to)) newInPeriod += 1;
    }
    if (s.lastResponseAt && (!latestResponse || s.lastResponseAt > latestResponse)) latestResponse = s.lastResponseAt;
    if (s.receivedAt && (!latestReceived || s.receivedAt > latestReceived)) latestReceived = s.receivedAt;
    if (s.estimated) estimatedCount += 1;
    if (!s.releaseKnown) unknownVersionCount += 1;
    const d = durationOf(r);
    if (d !== null && !r.status.markers.includes("invalid")) durations.push(d);
    if (s.terminal && s.requiredCompletion !== null && !r.status.markers.includes("invalid")) completions.push(s.requiredCompletion);
  }
  const usable = rows.filter((r) => !r.status.markers.includes("invalid"));
  const done = usable.filter((r) => ["complete", "incomplete", "abandoned"].includes(r.status.lifecycle));
  const completeN = done.filter((r) => r.status.lifecycle === "complete").length;
  const metrics: OverviewMetrics = {
    started: rows.length,
    complete: counts.get("complete") ?? 0,
    incomplete: counts.get("incomplete") ?? 0,
    abandoned: counts.get("abandoned") ?? 0,
    inProgress: counts.get("in_progress") ?? 0,
    notStarted: counts.get("not_started") ?? 0,
    needsReview: counts.get("needs_review") ?? 0,
    invalid: counts.get("invalid") ?? 0,
    test: counts.get("test") ?? 0,
    flagged,
    completionRate: done.length > 0 ? completeN / done.length : null,
    completionRateDenominator: done.length,
    medianDurationMs: durations.length >= MIN_DURATION_N ? median(durations) : null,
    durationN: durations.length,
    newInPeriod,
    latestResponseAt: latestResponse,
    latestReceivedAt: latestReceived,
    meanRequiredCompletion: mean(completions),
    estimatedCount,
    unknownVersionCount,
  };

  // ── time series ──────────────────────────────────────────────────────────
  const startDays = rows.map((r) => (r.summary.startedAt ? dayKey(Date.parse(r.summary.startedAt), tz) : null)).filter((d): d is string => d !== null);
  const firstDay = ctx.range.fromDay ?? startDays.reduce<string | null>((m, d) => (m === null || d < m ? d : m), null);
  const lastDay = ctx.range.toDay ?? (startDays.length ? startDays.reduce((m, d) => (d > m ? d : m)) : null);
  let granularity: "day" | "week" = "day";
  const series: SeriesPoint[] = [];
  if (firstDay && lastDay) {
    const span = daysBetween(firstDay, lastDay);
    granularity = span > 92 ? "week" : "day";
    const bucketOf = (day: string) => (granularity === "week" ? weekStart(day) : day);
    const buckets = new Map<string, { started: number; completed: number; done: number; completeCohort: number; completions: number[] }>();
    const step = granularity === "week" ? 7 : 1;
    for (let d = bucketOf(firstDay); d <= lastDay; d = addDays(d, step)) {
      buckets.set(d, { started: 0, completed: 0, done: 0, completeCohort: 0, completions: [] });
    }
    for (const r of rows) {
      const s = r.summary;
      if (s.startedAt) {
        const b = buckets.get(bucketOf(dayKey(Date.parse(s.startedAt), tz)));
        if (b) {
          b.started += 1;
          if (!r.status.markers.includes("invalid") && ["complete", "incomplete", "abandoned"].includes(r.status.lifecycle)) {
            b.done += 1;
            if (r.status.lifecycle === "complete") b.completeCohort += 1;
          }
          if (s.terminal && s.requiredCompletion !== null && !r.status.markers.includes("invalid")) b.completions.push(s.requiredCompletion);
        }
      }
      if (r.status.lifecycle === "complete" && s.completedAt) {
        const b = buckets.get(bucketOf(dayKey(Date.parse(s.completedAt), tz)));
        if (b) b.completed += 1;
      }
    }
    for (const [bucket, b] of buckets) {
      series.push({
        bucket,
        started: b.started,
        completed: b.completed,
        terminalOrAbandoned: b.done,
        completionRate: b.done > 0 ? b.completeCohort / b.done : null,
        meanCompletion: mean(b.completions),
      });
    }
  }

  // ── sections, missing questions, drop-off ─────────────────────────────────
  const sectionAgg = new Map<string, SectionStat>();
  const missing = new Map<string, number>();
  const drop = new Map<string, number>();
  const dropSec = new Map<string, number>();
  const signals = new Map<string, number>();
  const sites = new Map<string, SiteStat>();
  for (const r of usable) {
    const s = r.summary;
    for (const sec of s.sections) {
      let a = sectionAgg.get(sec.key);
      if (!a) {
        a = { key: sec.key, title: defs.section(sec.key) ?? sec.key, sessionsApplicable: 0, sessionsReached: 0, sessionsWithMissing: 0, required: 0, resolved: 0, completion: null };
        sectionAgg.set(sec.key, a);
      }
      if (sec.applicable) a.sessionsApplicable += 1;
      if (sec.reached) a.sessionsReached += 1;
      if (sec.applicable && sec.resolved < sec.required) a.sessionsWithMissing += 1;
      a.required += sec.required;
      a.resolved += sec.resolved;
    }
    for (const k of s.missingRequiredKeys) missing.set(k, (missing.get(k) ?? 0) + 1);
    if (!s.terminal && s.hasResponses) {
      if (s.lastPresentedKey) drop.set(s.lastPresentedKey, (drop.get(s.lastPresentedKey) ?? 0) + 1);
      if (s.finalSectionKey) dropSec.set(s.finalSectionKey, (dropSec.get(s.finalSectionKey) ?? 0) + 1);
    }
    if (s.site) {
      const st = sites.get(s.site) ?? { site: s.site, count: 0, finished: 0, finishedComplete: 0 };
      st.count += 1;
      if (["complete", "incomplete", "abandoned"].includes(r.status.lifecycle)) {
        st.finished += 1;
        if (r.status.lifecycle === "complete") st.finishedComplete += 1;
      }
      sites.set(s.site, st);
    }
  }
  for (const r of rows) for (const w of r.status.signals) signals.set(w, (signals.get(w) ?? 0) + 1);
  for (const a of sectionAgg.values()) a.completion = a.required > 0 ? a.resolved / a.required : null;

  const toQuestionCounts = (m: Map<string, number>, limit: number): QuestionCount[] =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || defs.questionOrder(a[0]) - defs.questionOrder(b[0]))
      .slice(0, limit)
      .map(([key, count]) => ({ key, count, text: defs.question(key)?.text ?? key, sectionTitle: defs.question(key)?.sectionTitle ?? "" }));

  // ── versions ─────────────────────────────────────────────────────────────
  const byVersion = new Map<string, SessionRow[]>();
  for (const r of rows) {
    const h = r.summary.releaseKnown && r.summary.releaseHash ? r.summary.releaseHash : "unknown";
    const list = byVersion.get(h);
    if (list) list.push(r);
    else byVersion.set(h, [r]);
  }
  const releaseByHash = new Map(ctx.releases.map((r) => [r.hash, r]));
  const versions: VersionStat[] = [...byVersion.entries()].map(([hash, list]) => {
    const rel = releaseByHash.get(hash);
    const u = list.filter((r) => !r.status.markers.includes("invalid"));
    const d = u.filter((r) => ["complete", "incomplete", "abandoned"].includes(r.status.lifecycle));
    const started = list.map((r) => r.summary.startedAt).filter((x): x is string => !!x).sort();
    const durs = list.map(durationOf).filter((x): x is number => x !== null);
    return {
      hash,
      key: rel?.key ?? list[0]?.summary.releaseKey ?? null,
      version: rel?.version ?? null,
      publishedAt: rel?.publishedAt ?? null,
      known: !!rel,
      sessions: list.length,
      complete: list.filter((r) => r.status.lifecycle === "complete").length,
      incomplete: list.filter((r) => r.status.lifecycle === "incomplete").length,
      abandoned: list.filter((r) => r.status.lifecycle === "abandoned").length,
      completionRate: d.length ? d.filter((r) => r.status.lifecycle === "complete").length / d.length : null,
      finished: d.length,
      finishedComplete: d.filter((r) => r.status.lifecycle === "complete").length,
      meanCompletion: mean(u.filter((r) => r.summary.terminal && r.summary.requiredCompletion !== null).map((r) => r.summary.requiredCompletion!)),
      medianDurationMs: durs.length >= MIN_DURATION_N ? median(durs) : null,
      firstStartedAt: started[0] ?? null,
      lastStartedAt: started[started.length - 1] ?? null,
    };
  });
  versions.sort((a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : a.version ? -1 : 1));

  // ── duration histogram ───────────────────────────────────────────────────
  const durationHistogram = DURATION_BINS.map(([fromMin, toMin]) => ({
    label: toMin === null ? `${fromMin}+ min` : `${fromMin}–${toMin} min`,
    fromMin,
    toMin,
    count: durations.filter((d) => d >= fromMin * 60_000 && (toMin === null || d < toMin * 60_000)).length,
  }));

  return {
    computedAt: ctx.now.toISOString(),
    granularity,
    metrics,
    series,
    statusBreakdown: DISPLAY_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
    sections: [...sectionAgg.values()].sort((a, b) => defs.sectionOrder(a.key) - defs.sectionOrder(b.key)),
    topMissing: toQuestionCounts(missing, 10),
    dropOff: toQuestionCounts(drop, 10),
    dropOffSections: [...dropSec.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count, title: defs.section(key) ?? key })),
    versions,
    durationHistogram,
    signals: [...signals.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
    sites: [...sites.values()].sort((a, b) => b.count - a.count),
    durationDistribution: durationDistributionOf(durations),
  };
}
