import { describe, expect, it } from "vitest";
import { compareReleases, computeQuestionStats, poolingCompatibility, questionHistory } from "./questions.js";
import { buildRows } from "./query.js";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const [v1, v11, v2] = demoReleases().map((r) => r.index) as [ReturnType<typeof demoReleases>[0]["index"], ReturnType<typeof demoReleases>[0]["index"], ReturnType<typeof demoReleases>[0]["index"]];
const byHash = new Map([v1, v11, v2].map((r) => [r.hash, r]));
const summaries = generateDemoSittings({ now }).map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
const rows = buildRows(summaries, new Map(), DEFAULT_POLICY, now);

describe("question statistics for one version", () => {
  const stats = computeQuestionStats(rows, v11, DEFAULT_POLICY.requiredLevels);

  it("covers every question in the version, in order", () => {
    expect(stats.map((s) => s.key)).toEqual(v11.questions.map((q) => q.key));
  });

  it("keeps the arithmetic consistent", () => {
    for (const s of stats) {
      expect(s.answered + s.declined + s.unanswered).toBe(s.eligible);
      expect(s.shown).toBeGreaterThanOrEqual(s.answered - 0);
      if (s.responseRate !== null) expect(s.responseRate).toBeLessThanOrEqual(1);
    }
  });

  it("counts branching-hidden sittings apart from missing ones", () => {
    const feel = stats.find((s) => s.key === "demo_social.sm_feel")!;
    expect(feel.conditional).toBe(true);
    expect(feel.hiddenBranching).toBeGreaterThan(0);
  });

  it("distributions use this version's labels and stored codes", () => {
    const wb2 = stats.find((s) => s.key === "demo_wellbeing.wb2")!;
    expect(wb2.distribution.kind).toBe("options");
    if (wb2.distribution.kind === "options") {
      expect(wb2.distribution.options.find((o) => o.code === 2)?.label).toBe("Not often");
      expect(wb2.distribution.options.reduce((a, o) => a + o.count, 0)).toBe(wb2.distribution.total);
    }
    const v1wb2 = computeQuestionStats(rows, v1, DEFAULT_POLICY.requiredLevels).find((s) => s.key === "demo_wellbeing.wb2")!;
    if (v1wb2.distribution.kind === "options") expect(v1wb2.distribution.options.find((o) => o.code === 2)?.label).toBe("Rarely");
  });

  it("never summarises identifying or free-text answers", () => {
    expect(stats.find((s) => s.key === "demo_about.first_name")!.distribution.kind).toBe("none");
    expect(stats.find((s) => s.key === "demo_finish.future_message")!.distribution.kind).toBe("none");
  });

  it("puts reported invalid codes to one side instead of into a real option", () => {
    const all = [v1, v11, v2].flatMap((r) => computeQuestionStats(rows, r, DEFAULT_POLICY.requiredLevels));
    expect(all.some((s) => s.invalid > 0)).toBe(true);
  });
});

describe("across versions", () => {
  it("reports added, removed and changed questions by stable id", () => {
    const c = compareReleases(v11, v2);
    expect(c.added.map((q) => q.key)).toEqual(["demo_about.school_travel"]);
    expect(c.removed.map((q) => q.key)).toEqual(["demo_wellbeing.wb_extra"]);
    const feel = c.changed.find((q) => q.key === "demo_social.sm_feel")!;
    expect(feel.kinds).toContain("options_added");
    expect(feel.compatibility).toBe("incompatible");
    const hours = c.changed.find((q) => q.key === "demo_gaming.game_hours")!;
    expect(hours.kinds).toEqual(["branching"]);
    expect(hours.compatibility).toBe("caution");
  });

  it("warns about wording and label changes but does not forbid pooling", () => {
    const c = compareReleases(v1, v11);
    const quality = c.changed.find((q) => q.key === "demo_sleep.sleep_quality")!;
    expect(quality.kinds).toEqual(["wording"]);
    expect(quality.compatibility).toBe("caution");
    const wb1 = c.changed.find((q) => q.key === "demo_wellbeing.wb1")!;
    expect(wb1.kinds).toEqual(["labels"]);
  });

  it("gives each question a history across every version", () => {
    const h = questionHistory("demo_about.school_travel", [v2, v1, v11]);
    expect(h.map((e) => [e.version, e.present])).toEqual([["1.0.0", false], ["1.1.0", false], ["2.0.0", true]]);
    expect(poolingCompatibility("demo_social.sm_feel", [v1, v11, v2])).toBe("incompatible");
    expect(poolingCompatibility("demo_wellbeing.wb3", [v1, v11, v2])).toBe("caution");
    expect(poolingCompatibility("demo_about.age", [v1, v11, v2])).toBe("compatible");
  });
});
