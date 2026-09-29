import { describe, expect, it } from "vitest";
import {
  applyScheme,
  buildScoresView,
  compareToBenchmark,
  compareToGroup,
  DEFAULT_GROUP_SETTINGS,
  DEFAULT_SCHEMES,
  groupSettings,
  pickObservations,
  schoolYearOn,
  summarise,
  t975,
  yearGroupFromAnswer,
  yearGroupFromCode,
  type ScoredRow,
} from "./index.js";

const swemwbs = DEFAULT_SCHEMES.find((s) => s.key === "swemwbs")!;
const metric = swemwbs.outputs.find((o) => o.key === "metric")!;
const items = ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"];
const scoredAt = (v: number) => ({ swemwbs: applyScheme(swemwbs, Object.fromEntries(items.map((k) => [k, v]))) });

describe("year groups", () => {
  it("follow the 1 September cut-off in England and Wales", () => {
    // 11 on 31 August 2025 → Year 7 in 2025/26.
    expect(schoolYearOn("2014-08-31", "2025-10-01T10:00:00Z")).toBe(7);
    expect(schoolYearOn("2013-09-01", "2025-10-01T10:00:00Z")).toBe(7);
    expect(schoolYearOn("2014-09-01", "2025-10-01T10:00:00Z")).toBe(6);
    // The same child in the summer term is still in Year 7.
    expect(schoolYearOn("2014-08-31", "2026-07-15T10:00:00Z")).toBe(7);
    expect(schoolYearOn("2014-08-31", "2026-09-02T10:00:00Z")).toBe(8);
    expect(schoolYearOn("not a date", "2026-09-02T10:00:00Z")).toBeNull();
    expect(schoolYearOn("2024-01-01", "2026-09-02T10:00:00Z")).toBeNull();
  });

  it("can come from a study-code rule or a year-group answer", () => {
    const rules = groupSettings.parse({ yearGroup: { rules: [{ pattern: "^NDC08", yearGroup: 8 }, { pattern: "^NDC", yearGroup: 7 }] } }).yearGroup.rules;
    expect(yearGroupFromCode("ndc0812", rules)).toBe(8);
    expect(yearGroupFromCode("NDC0001", rules)).toBe(7);
    expect(yearGroupFromCode("BRD0001", rules)).toBeNull();
    expect(yearGroupFromAnswer("Year 9", 9)).toBe(9);
    expect(yearGroupFromAnswer(null, 10)).toBe(10);
    expect(yearGroupFromAnswer("Other", 99)).toBeNull();
  });

  it("refuses a rule that is not a valid pattern", () => {
    expect(groupSettings.safeParse({ yearGroup: { rules: [{ pattern: "([", yearGroup: 8 }] } }).success).toBe(false);
  });
});

describe("score summaries", () => {
  const rows = [3, 3, 4, 4, 5, 2].map((v) => scoredAt(v).swemwbs.outputs["metric"]!);

  it("give the mean, a t-based 95% interval and quartiles", () => {
    const s = summarise(rows, metric, { histogram: true })!;
    expect(s.n).toBe(6);
    const values = [19.25, 19.25, 25.03, 25.03, 35, 15.32];
    const mean = values.reduce((a, b) => a + b, 0) / 6;
    expect(s.mean).toBeCloseTo(mean, 10);
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / 5);
    expect(s.sd).toBeCloseTo(sd, 10);
    expect(s.ci![1] - s.mean).toBeCloseTo((2.571 * sd) / Math.sqrt(6), 2);
    expect(s.histogram!.reduce((a, b) => a + b.count, 0)).toBe(6);
  });

  it("count sittings in each band, with Wilson intervals", () => {
    const s = summarise(rows, metric)!;
    expect(s.bands["warwick_bands"]!.map((b) => b.count)).toEqual([1, 2, 2, 1]);
    const first = s.bands["warwick_bands"]![0]!;
    expect(first.share).toBeCloseTo(1 / 6);
    expect(first.lo).toBeLessThan(first.share);
    expect(first.hi).toBeGreaterThan(first.share);
  });

  it("t quantiles match tables", () => {
    expect(t975(5)).toBeCloseTo(2.571, 2);
    expect(t975(10)).toBeCloseTo(2.228, 2);
    expect(t975(30)).toBeCloseTo(2.042, 2);
    expect(t975(1000)).toBeCloseTo(1.962, 2);
  });

  it("compare with another group (Welch) and with a benchmark (in its SD units)", () => {
    const a = summarise([3, 3, 3, 4].map((v) => scoredAt(v).swemwbs.outputs["metric"]!), metric)!;
    const b = summarise([2, 2, 3, 2].map((v) => scoredAt(v).swemwbs.outputs["metric"]!), metric)!;
    const c = compareToGroup(a, b);
    expect(c.difference).toBeCloseTo(a.mean - b.mean);
    expect(c.ci![0]).toBeLessThan(c.difference);
    const vs = compareToBenchmark(a, { mean: 20, sd: 4 });
    expect(vs.standardised).toBeCloseTo((a.mean - 20) / 4);
  });
});

describe("the grouped view", () => {
  const row = (participantId: string, wave: number, school: string, yearGroup: number, v: number): ScoredRow => ({ participantId, wave, school, yearGroup, gender: null, scores: scoredAt(v) });
  const rows: ScoredRow[] = [
    row("A", 1, "NDC", 8, 2),
    row("A", 2, "NDC", 8, 4),
    row("B", 1, "NDC", 8, 3),
    row("C", 1, "NDC", 9, 3),
    row("D", 1, "BRD", 8, 5),
    row("E", 1, "BRD", 8, 4),
    row("F", 1, "LDS", 8, 4),
  ];
  const settings = { ...DEFAULT_GROUP_SETTINGS, minCell: 3, schools: { NDC: "Northdale College" } };

  it("counts each participant once, at their latest sitting, by default", () => {
    expect(pickObservations(rows, "latest")).toHaveLength(6);
    expect(pickObservations(rows, "latest").find((r) => r.participantId === "A")!.wave).toBe(2);
    expect(pickObservations(rows, "wave_2")).toHaveLength(1);
  });

  it("summarises by school, marking small groups", () => {
    const view = buildScoresView(rows, { schemes: [swemwbs], settings, observation: "latest", groupBy: "school", now: new Date() });
    const r = view.results.find((x) => x.output === "metric")!;
    expect(r.groups.map((g) => [g.label, g.n, g.small])).toEqual([
      ["BRD", 2, true],
      ["LDS", 1, true],
      ["Northdale College", 3, false],
    ]);
    expect(view.available.schools.map((s) => s.key)).toEqual(["BRD", "LDS", "NDC"]);
    expect(view.counts).toMatchObject({ sittings: 6, participants: 6, schools: 3 });
  });

  it("compares a school's year group with the same year group at other schools", () => {
    const view = buildScoresView(rows, { schemes: [swemwbs], settings, observation: "latest", groupBy: "schoolYear", focus: { school: "NDC", yearGroup: 8 }, now: new Date() });
    expect(view.focus).toMatchObject({ label: "Northdale College, Year 8", peersLabel: "Year 8 at other schools" });
    const r = view.results.find((x) => x.output === "metric")!;
    expect(r.focus!.summary!.n).toBe(2); // A (wave 2) and B; C is Year 9
    expect(r.focus!.peers!.n).toBe(3); // D, E, F
    expect(r.focus!.small).toBe(true);
    expect(r.focus!.vsPeers!.difference).toBeCloseTo(r.focus!.summary!.mean - r.focus!.peers!.mean);
  });
});
