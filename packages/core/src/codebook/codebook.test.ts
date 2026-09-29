import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexRelease } from "../manifest.js";
import { demoReleases } from "../node/synthetic.js";
import { codebookEntry, codebookProblems, DEFAULT_CODEBOOK, NAME_PATTERN } from "./index.js";

const dir = new URL("../../../../releases/", import.meta.url);
const releases = readdirSync(dir)
  .filter((f) => f.endsWith(".manifest.json"))
  .map((f) => indexRelease(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
const questions = releases.flatMap((r) => r.questions);

describe("the codebook", () => {
  it("names and labels every question in every published survey version", () => {
    expect(codebookProblems(questions)).toEqual([]);
    expect(questions.every((q) => q.named)).toBe(true);
  });

  it("uses names that work unchanged in R, Python, SPSS and Stata, one per question", () => {
    const names = Object.values(DEFAULT_CODEBOOK).map((e) => e.name);
    expect(names.every((n) => NAME_PATTERN.test(n))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    // A readable name must not be another question's survey variable, or a join on either would be ambiguous.
    const variables = new Map(questions.map((q) => [q.variable, q.key]));
    for (const [key, entry] of Object.entries(DEFAULT_CODEBOOK)) {
      const owner = variables.get(entry.name);
      if (owner) expect(owner, entry.name).toBe(key);
    }
  });

  it("numbers questionnaire items as the published scale does", () => {
    const r = releases.find((x) => x.version === "7.2.0")!;
    expect(r.byKey.get("sdq25_s.q13")).toMatchObject({ variable: "sdq25_q13", name: "sdq_13_unhappy", label: "SDQ 13: Often unhappy, down-hearted or tearful" });
    expect(r.byKey.get("rcads25.q18")).toMatchObject({ name: "rcads_18_death" });
    expect(r.byKey.get("swemwbs.mind")).toMatchObject({ variable: "swemwbs_q7", name: "swemwbs_07_own_mind" });
    expect(r.byKey.get("bisbas12_ybm.dr4")).toMatchObject({ name: "bas_drive_04_no_holds" });
    expect(r.byKey.get("macarthur_ssy.self")).toMatchObject({ variable: "ses_self", name: "ladder_school" });
  });

  it("keeps the survey variable, the Qualtrics name and the wording beside the readable name", () => {
    const q = releases.find((x) => x.version === "7.2.0")!.byKey.get("ybm_social_media.abstain_days")!;
    expect(q).toMatchObject({ variable: "sm_abstain_days", legacyVariable: "Abstaining_days_1", unit: "days" });
    expect(q.lede).toContain("not messaging apps");
  });

  it("names the synthetic demo survey's questions too, so the demo study reads like the real one", () => {
    const demo = demoReleases().flatMap((r) => r.index.questions);
    expect(codebookProblems(demo)).toEqual([]);
  });

  it("falls back to the survey variable and a shortened wording for a question it does not know", () => {
    const e = codebookEntry({ key: "new.q1", variable: "new_q1", text: "A".repeat(200) });
    expect(e).toMatchObject({ name: "new_q1", fromCodebook: false });
    expect(e.label).toHaveLength(80);
    expect(codebookProblems([{ key: "new.q1", variable: "new_q1" }])[0]!.message).toContain("no readable name");
  });
});
