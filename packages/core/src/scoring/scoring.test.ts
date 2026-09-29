import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexRelease } from "../manifest.js";
import { applyScheme, bandRange, checkScheme, DEFAULT_SCHEMES, parseScheme, scoringScheme, type ScoringScheme } from "./index.js";

const dir = new URL("../../../../releases/", import.meta.url);
const releases = readdirSync(dir)
  .filter((f) => f.endsWith(".manifest.json"))
  .map((f) => indexRelease(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
const scheme = (key: string) => DEFAULT_SCHEMES.find((s) => s.key === key)!;
const all = (keys: string[], v: number) => Object.fromEntries(keys.map((k) => [k, v]));
const sdqItems = Array.from({ length: 25 }, (_, i) => `q${i + 1}`);

describe("default schemes against the survey's real releases", () => {
  it("parse, and cover every scored instrument the survey administers", () => {
    expect(DEFAULT_SCHEMES).toHaveLength(13);
    const latest = releases.find((r) => r.version === "7.2.0")!;
    for (const s of DEFAULT_SCHEMES) expect(checkScheme(s, latest).applies, s.key).toBe(true);
  });

  it("name only items that exist, with reversals that fit the codes, in every release", () => {
    for (const r of releases) {
      for (const s of DEFAULT_SCHEMES) {
        const c = checkScheme(s, r);
        expect(c.issues.filter((i) => i.level === "error"), `${s.key} v${r.version}`).toEqual([]);
      }
    }
  });

  it("catch a scheme naming items the release does not have (as the survey's own SWEMWBS definition did before r7.2.0)", () => {
    const wrong = scoringScheme.parse({ ...scheme("swemwbs"), outputs: [{ ...scheme("swemwbs").outputs[0]!, calc: { op: "sum", items: ["q1", "q2", "q3", "q4", "q5", "q6", "q7"], minValid: 7 } }] });
    const c = checkScheme(wrong, releases.at(-1)!);
    expect(c.issues.filter((i) => i.level === "error")).toHaveLength(7);
    expect(c.issues[0]!.message).toContain("will be blank");
  });

  it("catch a reversal that does not fit the codes", () => {
    const wrong = scoringScheme.parse({ ...scheme("sdq25_s"), transforms: [{ op: "reverse", items: ["q7"], maxPlusMin: 3 }] });
    expect(checkScheme(wrong, releases.at(-1)!).issues[0]!.message).toBe('"q7" is coded 0–2, so it reverses with 2, not 3.');
  });
});

describe("SDQ (youthinmind scoring)", () => {
  const s = scheme("sdq25_s");

  it("reverses items 7, 11, 14, 21 and 25 and sums each subscale", () => {
    // Every item 'Certainly true' (2): reversed items become 0.
    const out = applyScheme(s, all(sdqItems, 2)).outputs;
    expect(out["emotional"]!.value).toBe(10);
    expect(out["conduct"]!.value).toBe(8); // q7 reversed
    expect(out["hyperactivity"]!.value).toBe(6); // q21, q25 reversed
    expect(out["peer"]!.value).toBe(6); // q11, q14 reversed
    expect(out["prosocial"]!.value).toBe(10);
    expect(out["total_difficulties"]!.value).toBe(30);
    expect(out["externalising"]!.value).toBe(14);
    expect(out["internalising"]!.value).toBe(16);
  });

  it("prorates a subscale from three or four items, and not from two", () => {
    const three = applyScheme(s, { q3: 2, q8: 2, q13: 1 }).outputs["emotional"]!;
    expect(three).toMatchObject({ value: 8, valid: 3, of: 5 }); // 5/3 × 5 = 8.33 → 8
    const four = applyScheme(s, { q3: 1, q8: 1, q13: 1, q16: 0 }).outputs["emotional"]!;
    expect(four.value).toBe(4); // 3/4 × 5 = 3.75 → 4
    expect(applyScheme(s, { q3: 2, q8: 2 }).outputs["emotional"]!).toMatchObject({ value: null, valid: 2 });
  });

  it("needs all four difficulty subscales for the total", () => {
    const answers = all(sdqItems, 1);
    delete answers["q6"];
    delete answers["q11"];
    delete answers["q14"];
    const out = applyScheme(s, answers).outputs;
    expect(out["peer"]!.value).toBeNull();
    expect(out["total_difficulties"]!.value).toBeNull();
    expect(out["externalising"]!.value).not.toBeNull();
  });

  it("bands scores with the four-band and three-band self-report cut-points", () => {
    const out = applyScheme(s, all(sdqItems, 1)).outputs;
    expect(out["total_difficulties"]!.value).toBe(20);
    const total = s.outputs.find((o) => o.key === "total_difficulties")!;
    const four = total.thresholds.find((t) => t.key === "four_band")!;
    expect(four.bands[out["total_difficulties"]!.bands["four_band"]!]!.label).toBe("Very high");
    expect(total.thresholds[1]!.bands[out["total_difficulties"]!.bands["three_band"]!]!.label).toBe("Abnormal");
    expect([0, 1, 2, 3].map((i) => bandRange(four, i, total))).toEqual(["0–14", "15–17", "18–19", "20–40"]);
    // Prosocial runs the other way: low is the concern.
    const prosocial = s.outputs.find((o) => o.key === "prosocial")!;
    expect(prosocial.thresholds[0]!.bands[out["prosocial"]!.bands["four_band"]!]!.label).toBe("Low");
    expect([0, 1, 2, 3].map((i) => bandRange(prosocial.thresholds[0]!, i, prosocial))).toEqual(["0–4", "5", "6", "7–10"]);
  });
});

describe("SWEMWBS (Warwick scoring)", () => {
  const s = scheme("swemwbs");
  const items = ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"];

  it("converts the raw total to the metric score", () => {
    expect(applyScheme(s, all(items, 3)).outputs["metric"]!.value).toBe(19.25); // raw 21
    expect(applyScheme(s, all(items, 5)).outputs["metric"]!.value).toBe(35);
    expect(applyScheme(s, all(items, 1)).outputs["metric"]!.value).toBe(7);
  });

  it("needs all seven items", () => {
    const answers = all(items, 4);
    answers["mind"] = null;
    expect(applyScheme(s, answers).outputs["metric"]!.value).toBeNull();
  });

  it("bands the metric score", () => {
    const metric = s.outputs.find((o) => o.key === "metric")!;
    const set = metric.thresholds[0]!;
    const band = (v: number) => set.bands[applyScheme(s, all(items, v)).outputs["metric"]!.bands["warwick_bands"]!]!.label;
    expect(band(3)).toBe("Possible depression");
    expect(band(2)).toBe("Probable depression");
    expect(band(4)).toBe("Average"); // raw 28 → 25.03
    expect(band(5)).toBe("High wellbeing");
    expect(bandRange(set, 0, metric)).toBe("7–17");
    expect(bandRange({ ...set, bands: set.bands.map(({ display: _d, ...b }) => b) }, 0, metric)).toBe("up to 17.5");
  });
});

describe("the other official and adapted schemes", () => {
  it("RCADS-25 sums depression, anxiety and the total", () => {
    const out = applyScheme(scheme("rcads25"), all(sdqItems, 1)).outputs;
    expect([out["depression"]!.value, out["anxiety"]!.value, out["total"]!.value]).toEqual([10, 15, 25]);
  });

  it("STAI-5 sums five items", () => {
    expect(applyScheme(scheme("stai5_s"), { upset: 1, frightened: 2, nervous: 3, jittery: 4, confused: 1 }).outputs["state_anxiety"]!.value).toBe(11);
  });

  it("BIS/BAS reverses the 1 (very true) … 4 (very false) responses so higher is more of the trait", () => {
    const out = applyScheme(scheme("bisbas12_ybm"), all(["bis1", "bis2", "bis3", "bis4", "rr1", "rr2", "rr3", "rr4", "dr1", "dr2", "dr3", "dr4"], 1)).outputs;
    expect([out["bis"]!.value, out["bas_reward"]!.value, out["bas_drive"]!.value]).toEqual([16, 16, 16]);
  });

  it("EHI-SF gives the laterality quotient and Veale's handedness groups", () => {
    const s = scheme("ehi_sf");
    const right = applyScheme(s, { writing: 1, throwing: 1, toothbrush: 2, spoon: 3 }).outputs["lq"]!;
    expect(right.value).toBe(62.5);
    expect(s.outputs[0]!.thresholds[0]!.bands[right.bands["veale_2014"]!]!.label).toBe("Right-handed");
    const mixed = applyScheme(s, { writing: 1, throwing: 2, toothbrush: 3, spoon: 3 }).outputs["lq"]!;
    expect(s.outputs[0]!.thresholds[0]!.bands[mixed.bands["veale_2014"]!]!.label).toBe("Mixed-handed");
    expect(applyScheme(s, all(["writing", "throwing", "toothbrush", "spoon"], 5)).outputs["lq"]!.value).toBe(-100);
  });
});

describe("study-defined summaries", () => {
  it("social media: band midpoints, a weekly total and a 3-hour threshold", () => {
    const s = scheme("ybm_social_media");
    const out = applyScheme(s, { time_school_day: 4, time_nonschool_day: 6, night_checks: 1, lose_track: 6 }).outputs;
    expect(out["hours_week"]!.value).toBe(21.5); // 5 × 2.5 + 2 × 4.5
    expect(out["hours_school_day"]!.bands["three_hours"]).toBe(0);
    expect(out["hours_other_day"]!.bands["three_hours"]).toBe(1);
    expect(out["night_checking"]!.value).toBe(0);
    expect(out["lose_track"]!.value).toBeNull(); // "don't know"
  });

  it("screen dependence reads 'I can control…' the other way round", () => {
    const out = applyScheme(scheme("ybm_screen_attitudes"), { dependent: 1, addicted: 1, control: 5, impact_positive: 1, impact_negative: 5 }).outputs;
    expect(out["screen_dependence"]!.value).toBe(5);
    expect(out["impact_balance"]!.value).toBe(4);
  });
});

describe("scheme validation", () => {
  const base = scheme("stai5_s");
  const errors = (raw: unknown) => {
    const r = parseScheme(raw);
    return "errors" in r ? r.errors : [];
  };

  it("refuses an output that uses a later one", () => {
    const outputs = [{ key: "a", label: "A", calc: { op: "combine", outputs: ["b"], how: "sum" }, range: [0, 1], higherIs: "neutral" }, base.outputs[0]];
    expect(errors({ ...base, outputs }).join()).toContain('"b" must be an output listed before "a"');
  });

  it("refuses a partial sum without proration, and bands that do not increase", () => {
    const o = base.outputs[0]!;
    expect(errors({ ...base, outputs: [{ ...o, calc: { ...o.calc, minValid: 4 } }] }).join()).toContain("needs every item");
    const set = { key: "x", label: "X", basis: "study", source: "", bands: [{ label: "a", max: 10, level: 0 }, { label: "b", max: 8, level: 1 }, { label: "c", max: null, level: 2 }] };
    expect(errors({ ...base, outputs: [{ ...o, thresholds: [set] }] }).join()).toContain("must increase");
  });

  it("round-trips through JSON unchanged", () => {
    for (const s of DEFAULT_SCHEMES) {
      const again = parseScheme(JSON.parse(JSON.stringify(s)));
      expect("scheme" in again && again.scheme).toEqual(s as ScoringScheme);
    }
  });
});
