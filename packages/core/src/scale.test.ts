import { describe, expect, it } from "vitest";
import { buildRows, runQuery, neighbours, orderedRows } from "./query.js";
import { buildSummary, type SessionSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";
import { computeAnalytics } from "./analytics.js";
import { resolveRange } from "./dates.js";
import { DEFAULT_FILTERS, makePredicate } from "./filters.js";
import { computeQuestionStats } from "./questions.js";

/**
 * The design target is 20,000 sittings per study (docs/02 §2.4). This checks the
 * in-memory path stays interactive at that size.
 */
describe("at 20,000 sittings", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const rels = demoReleases().map((r) => r.index);
  const byHash = new Map(rels.map((r) => [r.hash, r]));
  const base = generateDemoSittings({ now, count: 200 }).map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
  const summaries: SessionSummary[] = [];
  for (let i = 0; i < 20_000; i += 1) {
    const s = base[i % base.length]!;
    summaries.push({ ...s, sessionId: `${s.sessionId.slice(0, 18)}${String(i).padStart(8, "0")}` });
  }

  it("filters, sorts, pages, finds neighbours and computes analytics quickly", () => {
    const t0 = performance.now();
    const rows = buildRows(summaries, new Map(), DEFAULT_POLICY, now);
    const q = runQuery(rows, { filters: { ...DEFAULT_FILTERS, statuses: ["incomplete", "abandoned"] }, search: "", sort: { key: "completion", dir: "asc" }, page: 3, pageSize: 50 }, { now, timeZone: "Europe/London" }, { studyCodes: true });
    const ordered = orderedRows(rows, { filters: DEFAULT_FILTERS, search: "", sort: { key: "startedAt", dir: "desc" } }, { now, timeZone: "Europe/London" }, { studyCodes: true });
    neighbours(ordered, ordered[5000]!.summary.sessionId);
    const filtered = rows.filter(makePredicate(DEFAULT_FILTERS, { now, timeZone: "Europe/London" }));
    computeAnalytics(filtered, { now, timeZone: "Europe/London", range: resolveRange("all", {}, now, "Europe/London"), releases: rels });
    computeQuestionStats(filtered, rels[2]!, DEFAULT_POLICY.requiredLevels);
    const ms = performance.now() - t0;
    expect(q.total).toBeGreaterThan(0);
    // Generous ceiling for CI machines; typically well under a second.
    expect(ms).toBeLessThan(8000);
  });

  it("a summary stays small enough to hold 20k in memory", () => {
    const bytes = Buffer.byteLength(JSON.stringify(base[10]));
    expect(bytes).toBeLessThan(8000);
  });
});
