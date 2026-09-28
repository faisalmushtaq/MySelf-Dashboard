import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexRelease, parseManifest, ManifestError } from "./manifest.js";
import { verifyManifestHash } from "./node/hash.js";
import { demoManifest } from "./node/synthetic.js";
import { assessSitting } from "./completeness.js";
import { replaySitting } from "./replay.js";

const ybm = (v: string) =>
  JSON.parse(readFileSync(new URL(`../test-fixtures/ybm/ybm_nd2026_standard_r${v}.manifest.json`, import.meta.url), "utf8")) as Record<string, unknown>;

describe("reading the survey's real release manifests", () => {
  it("indexes YBM r7.1.0 in the survey's presentation order", () => {
    const r = indexRelease(ybm("7.1.0"));
    expect(r.version).toBe("7.1.0");
    expect(r.sections.map((s) => s.key)).toEqual([
      "welcome", "about_you", "hands_and_ladders", "sleep", "wellbeing", "phones", "social_media", "gaming", "right_now",
    ]);
    // 147 items, of which 4 are info screens.
    expect(r.questions).toHaveLength(143);
    expect(r.byKey.get("sdq25_s.q13")?.options?.length).toBeGreaterThan(1);
    // Identifying items are known to be identifying.
    expect(r.questions.filter((q) => q.identifying).length).toBe(7);
    // The conditional section's condition is carried down to its questions.
    const social = r.sections.find((s) => s.key === "social_media")!;
    expect(social.conditional).toBe(true);
    expect(r.byKey.get(social.questionKeys[0]!)?.dependsOn).toEqual(
      expect.arrayContaining(["ybm_smartphone.sm_use"]),
    );
  });

  it("reads r5.0.0, which pre-dates identifying flags", () => {
    const r = indexRelease(ybm("5.0.0"));
    expect(r.questions.filter((q) => q.identifying)).toHaveLength(0);
    expect(r.questions.length).toBeGreaterThan(140);
  });

  it("reproduces the survey's release hash exactly", () => {
    for (const v of ["5.0.0", "7.1.0"]) {
      const m = ybm(v);
      const check = verifyManifestHash(m);
      expect(check.ok).toBe(true);
      expect(check.computed).toBe(m["hash"]);
    }
  });

  it("refuses a manifest whose content no longer matches its hash", () => {
    const m = ybm("7.1.0");
    (m["release"] as Record<string, unknown>)["publishedBy"] = "someone else";
    expect(verifyManifestHash(m).ok).toBe(false);
  });

  it("an unanswered YBM sitting is all 'not reached' or undetermined, never 'hidden'", () => {
    const r = indexRelease(ybm("7.1.0"));
    const a = assessSitting(replaySitting({ events: [], complete: false }), r, { requiredLevels: ["hard", "soft"] });
    const kinds = new Set(a.outcomes.map((o) => o.outcome));
    expect([...kinds].every((k) => k === "not_reached" || k === "undetermined")).toBe(true);
  });

  it("rejects something that is not a manifest, saying what is wrong", () => {
    expect(() => parseManifest({ release: {} })).toThrow(ManifestError);
  });

  it("builds the synthetic versions with valid hashes", () => {
    for (const v of ["1.0.0", "1.1.0", "2.0.0"] as const) expect(verifyManifestHash(demoManifest(v)).ok).toBe(true);
  });
});
