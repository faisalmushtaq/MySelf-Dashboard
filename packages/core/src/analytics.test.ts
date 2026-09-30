import { describe, expect, it } from "vitest";
import { computeAnalytics, median } from "./analytics.js";
import { buildRows } from "./query.js";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";
import { resolveRange } from "./dates.js";
import { makePredicate, DEFAULT_FILTERS } from "./filters.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const tz = "Europe/London";
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const summaries = generateDemoSittings({ now }).map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
const all = buildRows(summaries, new Map(), DEFAULT_POLICY, now);
const production = all.filter(makePredicate(DEFAULT_FILTERS, { now, timeZone: tz }));
const range = resolveRange("all", {}, now, tz);

describe("overview metrics", () => {
  const a = computeAnalytics(production, { now, timeZone: tz, range, releases: rels });

  it("lifecycle counts add up to the sittings counted", () => {
    const m = a.metrics;
    expect(m.complete + m.incomplete + m.abandoned + m.inProgress + m.notStarted).toBe(m.started);
  });

  it("completion rate = complete ÷ (complete + incomplete + abandoned), excluding invalid", () => {
    const usable = production.filter((r) => !r.status.markers.includes("invalid"));
    const done = usable.filter((r) => ["complete", "incomplete", "abandoned"].includes(r.status.lifecycle));
    expect(a.metrics.completionRateDenominator).toBe(done.length);
    expect(a.metrics.completionRate).toBeCloseTo(done.filter((r) => r.status.lifecycle === "complete").length / done.length, 10);
  });

  it("median completion time uses complete, never-resumed sittings only", () => {
    expect(a.metrics.durationN).toBe(production.filter((r) => r.status.lifecycle === "complete" && r.summary.resumedCount === 0 && r.summary.durationMs !== null && !r.status.markers.includes("invalid")).length);
    expect(a.metrics.medianDurationMs).toBeGreaterThan(60_000);
  });

  it("hides a median computed from fewer than five sittings", () => {
    const few = computeAnalytics(production.filter((r) => r.status.lifecycle === "complete").slice(0, 3), { now, timeZone: tz, range, releases: rels });
    expect(few.metrics.medianDurationMs).toBeNull();
  });

  it("series cover the whole range with no gaps", () => {
    const sept = resolveRange("this_month", {}, now, tz);
    const s = computeAnalytics(production, { now, timeZone: tz, range: sept, releases: rels });
    expect(s.granularity).toBe("day");
    expect(s.series).toHaveLength(28);
    expect(s.series[0]!.bucket).toBe("2026-09-01");
  });

  it("reports activity per version, newest first, with an unregistered version last", () => {
    expect(a.versions.map((v) => v.version)).toEqual(["2.0.0", "1.1.0", "1.0.0", null]);
    expect(a.versions.at(-1)!.known).toBe(false);
    // Every counted sitting, once: quarantined and unreadable ones are left out of the Overview.
    expect(a.versions.reduce((n, v) => n + v.sessions, 0)).toBe(production.filter((r) => !r.summary.quarantined && !r.summary.unreadable).length);
  });

  it("section completion treats a skipped-by-logic section as not applicable", () => {
    const social = a.sections.find((s) => s.key === "social_media")!;
    expect(social.sessionsApplicable).toBeLessThan(a.sections.find((s) => s.key === "sleep")!.sessionsApplicable);
  });

  it("counts the two completion measures over one denominator", () => {
    const m = a.metrics;
    expect(m.allRequiredAnswered).toBe(Math.round(m.completionRate! * m.completionRateDenominator));
    expect(m.reachedEnd).toBeGreaterThanOrEqual(m.allRequiredAnswered);
    expect(m.reachedEnd).toBeLessThanOrEqual(m.completionRateDenominator);
  });

  it("leaves quarantined and unreadable sittings out of every figure, and counts them", () => {
    // As the survey's researcher view never receives them (its pull leaves them out).
    const clean = production.filter((r) => !r.summary.quarantined && !r.summary.unreadable);
    const held = clean.slice(0, 3).map((r, i) => ({ ...r, summary: { ...r.summary, quarantined: i < 2, unreadable: i === 2 } }));
    const b = computeAnalytics([...held, ...clean.slice(3)], { now, timeZone: tz, range, releases: rels });
    expect(b.metrics.quarantined).toBe(2);
    expect(b.metrics.unreadable).toBe(1);
    expect(b.metrics.started).toBe(clean.length - 3);
    const m = b.metrics;
    expect(m.complete + m.incomplete + m.abandoned + m.inProgress + m.notStarted).toBe(m.started);
    expect(b.versions.reduce((n, v) => n + v.sessions, 0)).toBe(clean.length - 3);
  });

  it("median is the middle value", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
