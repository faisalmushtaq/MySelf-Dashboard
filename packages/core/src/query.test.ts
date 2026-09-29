import { describe, expect, it } from "vitest";
import { buildRows, compareRows, idAtPosition, neighbours, orderedRows, runQuery } from "./query.js";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";
import { DEFAULT_FILTERS } from "./filters.js";
import { emptyReview } from "./review.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const summaries = generateDemoSittings({ now }).map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
const ctx = { now, timeZone: "Europe/London" };

const flagged = [summaries[3]!.sessionId, summaries[20]!.sessionId];
const reviews = new Map(flagged.map((id) => [id, { ...emptyReview(id), status: "needs_review" as const }]));
const rows = buildRows(summaries, reviews, DEFAULT_POLICY, now);

describe("session query", () => {
  it("pages without losing or repeating a sitting", () => {
    const all = new Set<string>();
    const first = runQuery(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: "", sort: { key: "startedAt", dir: "desc" }, page: 1, pageSize: 25 }, ctx, { studyCodes: true });
    for (let p = 1; p <= first.pageCount; p += 1) {
      const r = runQuery(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: "", sort: { key: "startedAt", dir: "desc" }, page: p, pageSize: 25 }, ctx, { studyCodes: true });
      for (const x of r.rows) all.add(x.summary.sessionId);
    }
    expect(all.size).toBe(rows.length);
  });

  it("clamps an out-of-range page and refuses odd page sizes", () => {
    const r = runQuery(rows, { filters: DEFAULT_FILTERS, search: "", sort: { key: "startedAt", dir: "desc" }, page: 999, pageSize: 7 }, ctx, { studyCodes: true });
    expect(r.pageSize).toBe(50);
    expect(r.page).toBe(r.pageCount);
  });

  it("sorts with nulls last in both directions, and stably", () => {
    for (const dir of ["asc", "desc"] as const) {
      const sorted = [...rows].sort((a, b) => compareRows(a, b, { key: "completedAt", dir }));
      const firstNull = sorted.findIndex((r) => r.summary.completedAt === null);
      expect(sorted.slice(firstNull).every((r) => r.summary.completedAt === null)).toBe(true);
    }
    const byCompletion = [...rows].sort((a, b) => compareRows(a, b, { key: "completion", dir: "asc" }));
    const values = byCompletion.map((r) => r.summary.requiredCompletion).filter((x): x is number => x !== null);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("search finds session ids, and study codes only for roles that may see them", () => {
    const code = summaries[10]!.studyCode!;
    const withCodes = orderedRows(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: code, sort: { key: "startedAt", dir: "desc" } }, ctx, { studyCodes: true });
    expect(withCodes.map((r) => r.summary.studyCode)).toContain(code);
    const masked = orderedRows(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: code, sort: { key: "startedAt", dir: "desc" } }, ctx, { studyCodes: false });
    expect(masked).toHaveLength(0);
    const byId = orderedRows(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: summaries[10]!.sessionId.slice(-8).toLowerCase(), sort: { key: "startedAt", dir: "desc" } }, ctx, { studyCodes: false });
    expect(byId.map((r) => r.summary.sessionId)).toContain(summaries[10]!.sessionId);
  });

  it("previous / next follow the filtered, sorted list", () => {
    const ordered = orderedRows(rows, { filters: { ...DEFAULT_FILTERS, statuses: ["complete"] }, search: "", sort: { key: "startedAt", dir: "asc" } }, ctx, { studyCodes: true });
    const mid = ordered[4]!.summary.sessionId;
    const n = neighbours(ordered, mid, 2);
    expect(n.position).toBe(5);
    expect(n.total).toBe(ordered.length);
    expect(n.previousId).toBe(ordered[3]!.summary.sessionId);
    expect(n.nextId).toBe(ordered[5]!.summary.sessionId);
    expect(n.page).toBe(3);
    expect(idAtPosition(ordered, 5)).toBe(mid);
    const first = neighbours(ordered, ordered[0]!.summary.sessionId);
    expect(first.previousId).toBeNull();
    const outside = neighbours(ordered, "not-in-the-list");
    expect(outside.position).toBeNull();
  });

  it("finds the next flagged sitting", () => {
    const ordered = orderedRows(rows, { filters: { ...DEFAULT_FILTERS, dataset: "all" }, search: "", sort: { key: "startedAt", dir: "asc" } }, ctx, { studyCodes: true });
    const n = neighbours(ordered, ordered[0]!.summary.sessionId);
    expect(n.nextFlaggedId).not.toBeNull();
    const target = ordered.find((r) => r.summary.sessionId === n.nextFlaggedId)!;
    expect(target.status.markers).toContain("needs_review");
  });
});
