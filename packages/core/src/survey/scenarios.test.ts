import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessSitting } from "../completeness.js";
import { indexRelease } from "../manifest.js";
import { replaySitting } from "../replay.js";
import { validateAnswer } from "../validate.js";
import type { Sitting } from "../types.js";
import { DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES } from "../scoring/index.js";
import { buildDashboardBids, deriveStudyDataset, parseSurveyManifest, scoreStudy, type BidsExportInput } from "./index.js";

/**
 * The dashboard read against sittings the REAL SURVEY APP produced.
 *
 * Every other dashboard test builds its sittings: the demo study, or the
 * cross-check that plays answers into a manifest. That proves the dashboard
 * agrees with itself. These sittings come from the survey's own browser test
 * (MySelf e2e/scenarios.spec.ts), which walked the participant app down three
 * different paths and handed each sitting over as the encrypted file a
 * researcher receives — so the event log, the timing, the skips, the
 * auto-advance and the follow-up questions are exactly what an iPad records.
 *
 *   SCN0001  14, three languages (one named), social media, a 400-day answer
 *            confirmed, family control with "something else" typed as a
 *            spreadsheet formula, linkage yes
 *   SCN0002  20 (the 18+ SDQ), no social media, no postcode — a street found
 *            in the list instead — linkage no
 *   SCN0003  12, leaves every optional question blank, ethnicity declined,
 *            Polish
 *
 * Names, dates and the address (the University of Leeds campus) are invented.
 * Regenerate with the survey's `e2e/scenarios.spec.ts` whenever the release is
 * re-cut, and copy test-results/scenarios/r9-scenarios.json here.
 */

const fixture = JSON.parse(readFileSync(new URL("./fixtures/r9-scenarios.json", import.meta.url), "utf8")) as { sessions: Sitting[] };
const raw = JSON.parse(readFileSync(new URL("../../../../releases/ybm_nd2026_standard_r9.0.0.manifest.json", import.meta.url), "utf8")) as { hash: string };
const parsed = parseSurveyManifest(raw);
if ("error" in parsed) throw new Error(parsed.error);
const manifest = parsed.manifest;
const idx = indexRelease(raw);
const sittings: Sitting[] = fixture.sessions.map((s) => ({ ...s, events: s.events ?? [] }));
const byCode = new Map(sittings.map((s) => [s.studyCode, s]));
const data = deriveStudyDataset({ study: "ybm", sittings, manifests: new Map([[raw.hash, manifest]]) });

const sessionOf = (code: string) => byCode.get(code)!.sessionId;
const response = (code: string, variable: string) =>
  data.dataset.responses.find((r) => r.sessionId === sessionOf(code) && r.variable === variable);
const assess = (code: string) => {
  const s = byCode.get(code)!;
  return assessSitting(replaySitting(s), idx, { requiredLevels: ["hard", "soft"], sittingStart: s.startedAt! });
};

describe("sittings the real survey app produced (r9.0.0)", () => {
  it("are all from r9.0.0, and all read, with none held back", () => {
    expect(sittings).toHaveLength(3);
    for (const s of sittings) expect(s.releaseHash).toBe(raw.hash);
    expect(data.excluded).toEqual([]);
    expect(data.dataset.sessions).toHaveLength(3);
    // three different people: three IDs from name and date of birth
    expect(new Set(data.dataset.sessions.map((s) => s.participantId)).size).toBe(3);
  });

  it("assesses every sitting as finished, with no invalid answer and nothing answered that should have been hidden", () => {
    for (const code of byCode.keys()) {
      const a = assess(code!);
      expect(a.releaseKnown, code).toBe(true);
      expect(a.terminal, code).toBe(true);
      expect(a.invalidKeys, code).toEqual([]);
      expect(a.unknownItemKeys, code).toEqual([]);
      expect(a.outcomes.filter((o) => o.outcome === "answered_hidden").map((o) => o.key), code).toEqual([]);
      // Every recorded answer is valid as the release defines the question.
      for (const o of a.outcomes.filter((x) => x.outcome === "answered")) {
        const q = idx.byKey.get(o.key)!;
        const value = replaySitting(byCode.get(code)!).items.get(o.key)?.value;
        expect(validateAnswer(q, value).valid, `${code} ${o.key}`).toBe(true);
      }
    }
  });

  it("the answers who answered everything have no required question missing", () => {
    for (const code of ["SCN0001", "SCN0002"]) expect(assess(code).missingRequiredKeys, code).toEqual([]);
  });

  it("follows the display rules the device followed: SDQ by age, social media only if used, one language item per language", () => {
    const outcome = (code: string, key: string) => assess(code).outcomes.find((o) => o.key === key)?.outcome;
    expect(outcome("SCN0001", "sdq25_s.q1")).toBe("answered");
    expect(outcome("SCN0001", "sdq25_s18.q1")).toBe("hidden_branching");
    expect(outcome("SCN0002", "sdq25_s18.q1")).toBe("answered");
    expect(outcome("SCN0002", "sdq25_s.q1")).toBe("hidden_branching");
    expect(outcome("SCN0002", "ybm_social_media.abstain_days")).toBe("hidden_branching");
    expect(outcome("SCN0001", "ybm_demographics.understand_urdu")).toBe("answered");
    expect(outcome("SCN0001", "ybm_demographics.understand_polish")).toBe("hidden_branching");
    expect(outcome("SCN0003", "ybm_demographics.understand_polish")).toBe("answered");
    expect(outcome("SCN0003", "ybm_social_media.family_control_how")).toBe("hidden_branching");
  });

  it("reads each new question's answer as the participant gave it", () => {
    expect(response("SCN0001", "linkage_consent")?.value).toBe(1);
    expect(response("SCN0002", "linkage_consent")?.value).toBe(2);
    expect(response("SCN0001", "sqs_q1")?.value).toBe(7);
    expect(response("SCN0002", "sqs_q1")?.value).toBe(2);
    expect(response("SCN0003", "sqs_q1")?.value).toBe(10);
    expect(response("SCN0001", "sm_abstain_days")?.value).toBe(400);
    expect(response("SCN0001", "other_languages")?.label).toBe("Urdu | Punjabi | Another language");
    expect(response("SCN0001", "other_language_named")?.text).toBe("Pashto");
    expect(response("SCN0001", "understand_other_language")?.label).toBe("Only a few words");
    expect(response("SCN0003", "ethnicity")?.label).toBe("Prefer not to say");
    expect(response("SCN0001", "ethnicity")?.label).toBe("Pakistani");
  });

  it("names every question anyone answered in the codebook", () => {
    const recorded = new Set(data.dataset.responses.map((r) => `${r.instrument}.${r.item}`));
    // Rows that are not questions: information screens the device logs as seen,
    // and the age the survey derives from the date of birth.
    const notQuestions = [...recorded].filter((key) => !idx.byKey.has(key)).sort();
    expect(notQuestions).toEqual(["ehi_sf.lq_feedback", "ybm_demographics.age_years", "ybm_intro_consent.intro", "ybm_intro_consent.why_it_matters"]);
    const answered = [...recorded].filter((key) => idx.byKey.has(key));
    expect(answered.length).toBeGreaterThan(100);
    const unnamed = answered.filter((key) => !idx.byKey.get(key)!.named);
    expect(unnamed).toEqual([]);
    for (const key of answered) expect(idx.byKey.get(key)!.name, key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  });

  it("scores the sittings as the survey does", () => {
    const scored = new Map(
      scoreStudy(data, { schemes: DEFAULT_SCHEMES, releases: new Map([[raw.hash, idx]]), groups: DEFAULT_GROUP_SETTINGS }).map((s) => [s.sessionId, s.scores]),
    );
    const pairs: [string, string, string, string][] = [
      ["score.swemwbs", "raw_total", "swemwbs", "raw_total"],
      ["score.rcads25", "total_raw", "rcads25", "total_raw"],
      ["score.ehi_sf", "lq", "ehi_sf", "lq"],
    ];
    let compared = 0;
    for (const [key, output, scheme, ours] of pairs) {
      for (const row of data.dataset.scores.filter((r) => r.scoringKey === key && r.output === output)) {
        const mine = scored.get(row.sessionId)?.[scheme]?.outputs[ours]?.value ?? null;
        if (row.value === null && mine === null) continue;
        expect(mine, `${key}.${output} for ${row.sessionId}`).toBeCloseTo(Number(row.value), 6);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(3);
  });

  it("exports them as BIDS without a name, date of birth or address, and with no formula a spreadsheet would run", () => {
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const input: BidsExportInput = {
      study: "ybm",
      studyData: data,
      selected: new Set(sittings.map((s) => s.sessionId)),
      sittings: new Map(sittings.map((s) => [s.sessionId, s])),
      manifest,
      releaseVersions: new Map([[raw.hash, "9.0.0"]]),
      identifiers: true,
      includeFreeText: true,
      freeTextVariables: new Set(idx.questions.filter((q) => q.freeText && !q.identifying).map((q) => q.variable)),
      narratives: [],
      provenance: { exportId: "exp1", createdAt: "2026-09-30T06:00:00.000Z", createdBy: "researcher@brainpop.example", role: "owner", scope: "All permitted sessions", dateRange: "All time", filters: [], rulesVersion: "completeness@1" },
      hash,
    };
    const out = buildDashboardBids(input);
    const everything = out.files.map((f) => f.content).join("\n");
    for (const secret of ["Scenario", "Alpha", "Bravo", "Charlie", "Woodhouse", "LS2 9JT", "University of Leeds", "2012-05-14", "2006-03-01"]) {
      expect(everything, secret).not.toContain(secret);
    }
    // The new questions arrive under their codebook names.
    for (const name of ["linkage_consent", "sqs_sleep_quality", "first_language_english", "understand_urdu", "sm_family_control_how"]) {
      expect(everything, name).toContain(name);
    }
    // Free text is included here, and the typed formula is defused, never live.
    const tsvs = out.files.filter((f) => f.path.endsWith(".tsv")).map((f) => f.content).join("\n");
    expect(tsvs).toContain("Pashto");
    expect(tsvs).toContain(`'=HYPERLINK`);
    for (const line of tsvs.split("\n")) {
      for (const cell of line.split("\t")) expect(cell.startsWith("=") || cell.startsWith("+") || cell.startsWith("@"), cell).toBe(false);
    }
  });
});
