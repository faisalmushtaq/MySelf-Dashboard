import { describe, expect, it } from "vitest";
import {
  clearFilter,
  DEFAULT_FILTERS,
  describeFilters,
  filtersFromParams,
  filtersToParams,
  makePredicate,
  sanitiseFilters,
  sortFromParams,
  sortToParams,
  type FilterState,
  type SessionRow,
} from "./filters.js";
import { buildRows } from "./query.js";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";
import { emptyReview } from "./review.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const sittings = generateDemoSittings({ now });
const summaries = sittings.map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
const flaggedId = summaries[5]!.sessionId;
const reviews = new Map([
  [flaggedId, { ...emptyReview(flaggedId), status: "needs_review" as const, flags: [{ id: "f1", reason: "other" as const, note: "check", open: true, createdBy: "u", createdByEmail: null, createdAt: "", resolvedAt: null, resolvedBy: null }] }],
]);
const rows: SessionRow[] = buildRows(summaries, reviews, DEFAULT_POLICY, now);
const ctx = { now, timeZone: "Europe/London" };
const run = (f: Partial<FilterState>) => rows.filter(makePredicate({ ...DEFAULT_FILTERS, ...f }, ctx));

describe("filter URLs", () => {
  it("round-trip every clause", () => {
    const f: FilterState = {
      ...DEFAULT_FILTERS,
      datePreset: "custom",
      from: "2026-09-01",
      to: "2026-09-28",
      dateBasis: "completed",
      statuses: ["incomplete", "needs_review"],
      completionMin: 10,
      completionMax: 90,
      surveys: ["demo_wellbeing", "demo_followup"],
      versions: [rels[0]!.hash, "unknown"],
      sites: ["NDC"],
      sources: ["device"],
      flagged: "flagged",
      dataset: "all",
      reviewStatuses: ["reviewed"],
      questionKey: "demo_sleep.sleep_quality",
      questionOutcomes: ["skipped"],
      missingKey: "demo_about.age",
      dropOffKey: "demo_about.age",
      dropOffSection: "sleep",
      sectionIncomplete: "wellbeing",
      warning: "too_fast",
    };
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
  });

  it("omit defaults, so an unfiltered URL is clean", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(sortToParams({ key: "startedAt", dir: "desc" }).toString()).toBe("");
    expect(sortFromParams(new URLSearchParams("sort=completion&dir=asc"))).toEqual({ key: "completion", dir: "asc" });
  });

  it("drop anything unrecognised or malformed", () => {
    const f = filtersFromParams(new URLSearchParams("st=complete,hacked&v=notahash&site=<script>&cmin=-50&q=a%20b;drop&d=forever"));
    expect(f.statuses).toEqual(["complete"]);
    expect(f.versions).toEqual([]);
    expect(f.sites).toEqual([]);
    expect(f.completionMin).toBe(0);
    expect(f.questionKey).toBeUndefined();
    expect(f.datePreset).toBe("all");
  });

  it("never carry search text", () => {
    expect([...filtersToParams({ ...DEFAULT_FILTERS }).keys()]).not.toContain("search");
    expect(Object.keys(sanitiseFilters({ search: "NDC0001" }))).not.toContain("search");
  });
});

describe("predicates", () => {
  it("default view is production only", () => {
    expect(run({}).some((r) => r.status.markers.includes("test"))).toBe(false);
    expect(run({ dataset: "test" }).every((r) => r.status.markers.includes("test"))).toBe(true);
    expect(run({ dataset: "all" })).toHaveLength(rows.length);
  });

  it("a lifecycle filter includes sittings that also carry a marker", () => {
    const incomplete = run({ statuses: ["incomplete"], dataset: "all" });
    expect(incomplete.length).toBeGreaterThan(0);
    expect(incomplete.every((r) => r.status.lifecycle === "incomplete")).toBe(true);
    expect(incomplete.some((r) => r.status.display !== "incomplete")).toBe(true);
  });

  it("combines clauses with AND", () => {
    const both = run({ statuses: ["complete"], versions: [rels[2]!.hash] });
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((r) => r.status.lifecycle === "complete" && r.summary.releaseHash === rels[2]!.hash)).toBe(true);
  });

  it("filters by the stated date basis", () => {
    const sept = run({ datePreset: "custom", from: "2026-09-01", to: "2026-09-30", dateBasis: "completed" });
    expect(sept.every((r) => r.summary.completedAt !== null && r.summary.completedAt >= "2026-08-31")).toBe(true);
    const started = run({ datePreset: "custom", from: "2026-06-01", to: "2026-06-30" });
    expect(started.every((r) => r.summary.startedAt!.startsWith("2026-06"))).toBe(true);
  });

  it("completion range excludes sittings without a completeness value", () => {
    const low = run({ completionMax: 90, dataset: "all" });
    expect(low.every((r) => r.summary.requiredCompletion !== null && r.summary.requiredCompletion <= 0.9)).toBe(true);
  });

  it("'unknown' version matches sittings whose release is not registered", () => {
    const unknown = run({ versions: ["unknown"], dataset: "all" });
    expect(unknown.length).toBe(1);
    expect(unknown[0]!.summary.releaseKnown).toBe(false);
  });

  it("question outcome, missing question and drop-off filters", () => {
    const hidden = run({ questionKey: "demo_social.sm_feel", questionOutcomes: ["hidden_branching"] });
    expect(hidden.length).toBeGreaterThan(0);
    const notInVersion = run({ questionKey: "demo_about.school_travel", questionOutcomes: ["not_in_version"] });
    expect(notInVersion.every((r) => r.summary.releaseVersion !== "2.0.0")).toBe(true);
    const drops = run({ dropOffSection: "about_you" });
    expect(drops.every((r) => !r.summary.terminal)).toBe(true);
  });

  it("flagged / unflagged", () => {
    expect(run({ flagged: "flagged", dataset: "all" }).map((r) => r.summary.sessionId)).toEqual([flaggedId]);
    expect(run({ flagged: "unflagged", dataset: "all" })).toHaveLength(rows.length - 1);
  });
});

describe("filter chips", () => {
  it("describe and clear one clause at a time", () => {
    const f: FilterState = { ...DEFAULT_FILTERS, statuses: ["incomplete"], flagged: "flagged", completionMin: 20 };
    expect(describeFilters(f).map((c) => c.key)).toEqual(["statuses", "completionMin", "flagged"]);
    const cleared = clearFilter(f, "statuses");
    expect(cleared.statuses).toEqual([]);
    expect(cleared.flagged).toBe("flagged");
    expect(clearFilter(f, "completionMin").completionMin).toBeUndefined();
  });
});

describe("the survey filter", () => {
  // Two surveys in one study: the newest version is another survey's, as a Studio survey's would be.
  const newest = rels.at(-1)!;
  const surveyOf = (hash: string) => (hash === newest.hash ? "demo_followup" : (byHash.get(hash)?.survey ?? null));
  const surveyed = buildRows(summaries, reviews, DEFAULT_POLICY, now, { surveyOf });
  const pick = (f: Partial<FilterState>) => surveyed.filter(makePredicate({ ...DEFAULT_FILTERS, dataset: "all", ...f }, ctx));

  it("gives each row its release's survey, and none when the version is not registered", () => {
    expect(rels.every((r) => r.survey === "demo_wellbeing")).toBe(true);
    for (const r of surveyed) {
      if (!r.summary.releaseKnown) expect(r.survey).toBeNull();
      else expect(r.survey).toBe(r.summary.releaseHash === newest.hash ? "demo_followup" : "demo_wellbeing");
    }
    expect(surveyed.some((r) => r.survey === null)).toBe(true);
  });

  it("is all surveys by default, and one survey's sittings when chosen", () => {
    expect(pick({})).toHaveLength(surveyed.length);
    const followup = pick({ surveys: ["demo_followup"] });
    expect(followup.length).toBeGreaterThan(0);
    expect(followup.every((r) => r.summary.releaseHash === newest.hash)).toBe(true);
    const wellbeing = pick({ surveys: ["demo_wellbeing"] });
    // A sitting under an unregistered version belongs to no survey, so neither list has it.
    expect(wellbeing.length + followup.length).toBe(surveyed.filter((r) => r.summary.releaseKnown).length);
    expect(pick({ surveys: ["demo_wellbeing", "demo_followup"] })).toHaveLength(wellbeing.length + followup.length);
  });

  it("keeps only survey ids from a URL or a request, untouched", () => {
    expect(filtersFromParams(new URLSearchParams("sv=demo_wellbeing,Demo,a%2Fb,..,9x")).surveys).toEqual(["demo_wellbeing"]);
    expect(sanitiseFilters({ surveys: ["demo_followup", "ybm/../x", 7, "x".repeat(65)] }).surveys).toEqual(["demo_followup"]);
  });

  it("is described with the survey's title, and cleared with its chip", () => {
    const f = { ...DEFAULT_FILTERS, surveys: ["demo_followup"] };
    expect(describeFilters(f, { survey: (id) => (id === "demo_followup" ? "Follow-up" : id) })).toContainEqual({ key: "surveys", label: "Survey: Follow-up" });
    expect(clearFilter(f, "surveys").surveys).toEqual([]);
  });
});
