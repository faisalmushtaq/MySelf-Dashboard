import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexRelease, type ReleaseIndex } from "../manifest.js";
import { DEFAULT_SCHEMES, scoringScheme, type ScoringScheme } from "../scoring/index.js";
import { buildQualityReport, itemValue, reviewQuality, scoringUses } from "./index.js";

const dir = new URL("../../../../releases/", import.meta.url);
const releases = readdirSync(dir)
  .filter((f) => f.endsWith(".manifest.json"))
  .map((f) => indexRelease(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
const latest = releases.find((r) => r.version === "7.2.0")!;
const scheme = (key: string) => DEFAULT_SCHEMES.find((s) => s.key === key)!;
const withScheme = (s: ScoringScheme) => DEFAULT_SCHEMES.map((d) => (d.key === s.key ? s : d));
const review = (schemes = DEFAULT_SCHEMES, rs: readonly ReleaseIndex[] = releases) => reviewQuality({ releases: rs, schemes });
const ids = (f: ReturnType<typeof review>) => f.map((x) => x.id);

describe("the quality review of the real survey and the default schemes", () => {
  const findings = review();

  it("finds no errors: every question is named, every option scores as its label says, every key is the published one", () => {
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("warns about what needs a decision or care in analysis", () => {
    const warnings = findings.filter((f) => f.severity === "warning");
    expect(warnings.map((f) => f.id).sort()).toEqual(["versions.options.5.0.0.3", "wording.sdq_form"]);
    const platforms = warnings.find((f) => f.id === "versions.options.5.0.0.3")!;
    expect(platforms.keys).toHaveLength(11);
    expect(platforms.detail).toContain("'0 minutes'");
  });

  it("notes the agreement scales that run in opposite directions", () => {
    const f = findings.find((x) => x.id === "responses.agreement_direction")!;
    expect(f.detail).toContain("sm_lose_track");
    expect(f.detail).toContain("doom_01_urge");
  });

  it("tells presentation-only relabelling from a change of meaning", () => {
    const kss = findings.find((f) => f.area === "versions" && f.keys.includes("kss.q1"))!;
    expect(kss.detail).toContain("each code means the same");
    const gaming = findings.find((f) => f.area === "versions" && f.keys.includes("ybm_gaming.hours_week"))!;
    expect(gaming.detail).toContain("exactly 5 hours had no answer");
  });
});

describe("the quality review catches", () => {
  it("the RCADS-25 key as the survey (and the dashboard's 1.0.0) had it", () => {
    const old = scoringScheme.parse({
      ...scheme("rcads25"),
      outputs: scheme("rcads25").outputs.map((o) =>
        o.key === "depression" ? { ...o, calc: { op: "sum", items: ["q1", "q4", "q8", "q10", "q13", "q15", "q16", "q18", "q19", "q21"], minValid: 10 } } : o.key === "anxiety" ? { ...o, calc: { op: "sum", items: ["q2", "q3", "q5", "q6", "q7", "q9", "q11", "q12", "q14", "q17", "q20", "q22", "q23", "q24", "q25"], minValid: 15 } } : o,
      ),
    });
    const f = review(withScheme(old)).filter((x) => x.severity === "error");
    expect(ids(f).sort()).toEqual(["scoring.key.rcads25.anxiety", "scoring.key.rcads25.depression"]);
    expect(f.find((x) => x.id === "scoring.key.rcads25.depression")!.detail).toBe("Missing rcads_24_restless. Not in the published key: rcads_18_death. Scheme v1.1.0. Correct it in Settings → Scoring.");
  });

  it("an SDQ strength item left unreversed", () => {
    const s = scoringScheme.parse({ ...scheme("sdq25_s"), transforms: [{ op: "reverse", items: ["q11", "q14", "q21", "q25"], maxPlusMin: 2 }] });
    const f = review(withScheme(s), [latest]).filter((x) => x.severity === "error");
    expect(f.map((x) => x.title)).toEqual(["sdq_07_obeys: 'Certainly True' scores 2, not 0", "sdq_07_obeys: 'Not True' scores 0, not 2"]);
  });

  it("an agree-first item scored as if it were disagree-first", () => {
    const s = scoringScheme.parse({ ...scheme("ybm_social_media"), transforms: scheme("ybm_social_media").transforms.filter((t) => !t.items.includes("lose_track")) });
    const f = review(withScheme(s), [latest]).filter((x) => x.severity === "error");
    expect(f[0]!.title).toBe("sm_lose_track: 'Strongly Agree' scores 1, not 5");
    // …and 'Don't know' would then count as 6.
    expect(f.some((x) => x.title === "sm_lose_track: 'Don’t know' scores missing, not missing")).toBe(false);
  });

  it("a recode that scrambles an ordered scale", () => {
    const s = scoringScheme.parse({ ...scheme("ybm_gaming"), transforms: [{ op: "recode", items: ["hours_week"], map: { "1": 0, "2": 2.5, "3": 13, "4": 7.5, "5": 18, "6": 25 } }] });
    expect(ids(review(withScheme(s), [latest]))).toContain("scoring.monotone.ybm_gaming.hours_week.hours_week");
  });

  it("parent-report SDQ cut-points where the self-report ones belong", () => {
    const s = scoringScheme.parse({
      ...scheme("sdq25_s"),
      outputs: scheme("sdq25_s").outputs.map((o) => (o.key === "conduct" ? { ...o, thresholds: o.thresholds.map((t) => (t.key === "four_band" ? { ...t, bands: t.bands.map((b, i) => ({ ...b, max: [2, 3, 4, null][i]! })) } : t)) } : o)),
    });
    const f = review(withScheme(s), [latest]).find((x) => x.id === "scoring.bands.sdq25_s.conduct.four_band")!;
    expect(f.severity).toBe("warning");
    expect(f.detail).toContain("2 / 3 / 4 / top");
  });

  it("'Don't know' recorded as a real answer", () => {
    const raw = JSON.parse(readFileSync(new URL("ybm_nd2026_standard_r7.2.0.manifest.json", dir), "utf8")) as { scales: Record<string, { options: { label: string; kind?: string }[] }>; hash: string };
    for (const o of raw.scales["scale.agree_5pt_dk"]!.options) if (/know/i.test(o.label)) o.kind = "substantive";
    const broken = indexRelease(raw);
    const f = review(DEFAULT_SCHEMES, [broken]);
    expect(f.find((x) => x.id.startsWith("responses.kind."))!.title).toBe("'Don’t know' is recorded as a real answer");
  });
});

describe("the codebook of one version", () => {
  const report = buildQualityReport({ releases, release: latest, schemes: DEFAULT_SCHEMES });

  it("has a row per question with its readable name, wording, codes and what each code scores", () => {
    expect(report.rows).toHaveLength(latest.questions.length);
    const q7 = report.rows.find((r) => r.key === "sdq25_s.q7")!;
    expect(q7).toMatchObject({ name: "sdq_07_obeys", variable: "sdq25_q7", legacyVariable: "sdq_7" });
    expect(q7.scoring).toEqual([{ scheme: "sdq25_s", schemeName: "SDQ", schemeVersion: "1.1.0", output: "conduct", outputLabel: "Conduct problems", values: [2, 1, 0], transform: "reversed" }]);
    expect(q7.versions).toHaveLength(releases.length);
    expect(report.rows.find((r) => r.key === "sdq25_s.q20")!.findings).toContain("wording.sdq_form");
  });

  it("scores a question answered as a number as it stands", () => {
    const ladder = report.rows.find((r) => r.key === "macarthur_ssy.self")!;
    expect(ladder.scoring).toEqual([expect.objectContaining({ output: "school", transform: null })]);
    expect(ladder.scoring[0]!.values).toBeUndefined();
  });

  it("counts the findings by severity", () => {
    expect(report.counts).toEqual({ error: 0, warning: 2, note: report.findings.length - 2 });
  });

  it("uses the engine's own arithmetic", () => {
    expect(itemValue(scheme("bisbas12_ybm"), "dr1", 1)).toBe(4);
    expect(itemValue(scheme("ehi_sf"), "spoon", 5)).toBe(-100);
    expect(scoringUses(latest.byKey.get("rcads25.q24")!, DEFAULT_SCHEMES).map((u) => u.output)).toEqual(["depression"]);
  });
});
