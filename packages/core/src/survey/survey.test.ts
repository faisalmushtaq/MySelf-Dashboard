import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessSitting } from "../completeness.js";
import { indexRelease } from "../manifest.js";
import { replaySitting } from "../replay.js";
import { AnswerStore, evaluate, type AnswerValue } from "../vendor/engine.js";
import type { Sitting, SittingEvent } from "../types.js";
import { demoReleases, generateDemoSittings } from "../node/synthetic.js";
import { buildDashboardBids, deriveStudyDataset, parseSurveyManifest, participantsOverview, pseudonymiseDataset, scoreStudy, subsetDataset, type BidsExportInput } from "./index.js";
import { buildScoresView, DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES } from "../scoring/index.js";

// ── Fixtures: the synthetic study (never real data) and the real releases ───────

const release = (v: string) => JSON.parse(readFileSync(new URL(`../../../../releases/ybm_nd2026_standard_r${v}.manifest.json`, import.meta.url), "utf8")) as unknown;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

const demo = demoReleases();
const manifests = new Map(demo.map((r) => {
  const parsed = parseSurveyManifest(r.manifest);
  if ("error" in parsed) throw new Error(parsed.error);
  return [r.index.hash, parsed.manifest] as const;
}));
const sittings: Sitting[] = generateDemoSittings().map((d) => ({ ...d.doc, events: d.doc.events ?? [] }));
const study = deriveStudyDataset({ study: "demo", sittings, manifests });
const newest = [...manifests.values()].at(-1)!;
const freeText = new Set(demo.flatMap((r) => r.index.questions.filter((q) => q.freeText && !q.identifying).map((q) => q.variable)));

function input(overrides: Partial<BidsExportInput> = {}): BidsExportInput {
  return {
    study: "demo",
    studyData: study,
    selected: new Set(sittings.map((s) => s.sessionId)),
    sittings: new Map(sittings.map((s) => [s.sessionId, s])),
    manifest: newest,
    releaseVersions: new Map(demo.map((r) => [r.index.hash, r.index.version])),
    identifiers: true,
    includeFreeText: false,
    freeTextVariables: freeText,
    narratives: [],
    provenance: { exportId: "exp1", createdAt: "2026-09-29T10:00:00.000Z", createdBy: "researcher@brainpop.example", role: "researcher", scope: "All permitted sessions", dateRange: "All time", filters: [], rulesVersion: "completeness@1" },
    hash,
    ...overrides,
  };
}

const file = (files: { path: string; content: string }[], path: string) => files.find((f) => f.path === path)?.content ?? "";
const rows = (tsv: string) => {
  const [head, ...body] = tsv.trim().split("\n");
  const cols = head!.split("\t");
  return body.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i]!, v])));
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("survey release manifests", () => {
  it("reads every published version, adapting only the old finish-screen text", () => {
    for (const v of ["1.0.0", "4.0.0", "5.0.0", "7.1.0", "7.2.0"]) {
      const r = parseSurveyManifest(release(v));
      expect("manifest" in r, v).toBe(true);
      if ("manifest" in r) expect(r.adapted).toBe(v === "1.0.0" || v === "4.0.0");
    }
  });

  it("refuses a manifest whose data definitions do not parse", () => {
    const broken = structuredClone(release("7.1.0")) as { instruments: unknown };
    broken.instruments = "nope";
    expect("error" in parseSurveyManifest(broken)).toBe(true);
  });
});

describe("the study dataset, derived as the survey derives it", () => {
  it("links sittings to participant codes and numbers their waves", () => {
    const d = study.dataset;
    expect(d.participants.length).toBeGreaterThan(40);
    expect(d.sessions.some((s) => s.wave === 2)).toBe(true);
    for (const s of d.sessions) expect(s.participantId).toMatch(/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/);
  });

  it("never lets names, dates of birth or secret-code answers into the data", () => {
    expect(study.dataset.responses.some((r) => r.instrument === "ybm_identity" || r.variable === "first_name")).toBe(false);
  });

  it("holds back sittings it cannot link, and says why", () => {
    const reasons = new Set(study.excluded.map((e) => e.reason));
    expect(reasons.has("secret code incomplete — cannot be linked to a participant")).toBe(true);
    expect(reasons.has("quarantined in the survey")).toBe(true);
    expect(reasons.has("survey version not readable")).toBe(true);
    const accounted = new Set([...study.dataset.sessions.map((s) => s.sessionId), ...study.excluded.map((e) => e.sessionId)]);
    expect(accounted.size).toBe(sittings.length);
  });

  it("reports twins sharing a code by code and sittings — never by name", () => {
    expect(study.collisions).toHaveLength(1);
    expect(study.collisions[0]!.sessionIds).toHaveLength(2);
    expect(JSON.stringify(study.collisions)).not.toMatch(/Alex|Sam|Jordan|Riley|Casey|Morgan|Taylor|Jamie|Robin|Charlie/);
  });

  it("applies the study's code corrections", () => {
    const code = study.dataset.sessions[0]!.participantId;
    const corrected = deriveStudyDataset({ study: "demo", sittings, manifests, aliases: { [code]: "ZZ999ZZ" } });
    expect(corrected.dataset.sessions.some((s) => s.participantId === code)).toBe(false);
    expect(corrected.dataset.sessions.some((s) => s.participantId === "ZZ999ZZ")).toBe(true);
  });

  it("keeps study-wide wave numbers when restricted to some sittings", () => {
    const second = study.dataset.sessions.find((s) => s.wave === 2)!;
    const sub = subsetDataset(study.dataset, new Set([second.sessionId]));
    expect(sub.sessions).toHaveLength(1);
    expect(sub.sessions[0]!.wave).toBe(2);
    expect(sub.participants).toHaveLength(1);
    expect(sub.participants[0]!.sessionCount).toBe(1);
    expect(sub.responses.every((r) => r.sessionId === second.sessionId)).toBe(true);
  });
});

describe("BIDS export with identifiers (the default)", () => {
  const out = buildDashboardBids(input());

  it("has the survey's layout plus a README, linkage file and manifest", () => {
    const paths = out.files.map((f) => f.path);
    for (const p of ["dataset_description.json", "participants.tsv", "participants.json", "README.md", "linkage.tsv", "linkage.json", "export_manifest.json", ".bidsignore"]) expect(paths).toContain(p);
    expect(paths.some((p) => /^phenotype\/demo_sleep\.tsv$/.test(p))).toBe(true);
    expect(paths.some((p) => /^sub-[A-Z0-9]+\/sessions\.tsv$/.test(p))).toBe(true);
  });

  it("labels subjects with participant codes and lists every sitting in linkage.tsv", () => {
    const participants = rows(file(out.files, "participants.tsv"));
    expect(participants.every((p) => /^sub-[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(p["participant_id"]!))).toBe(true);
    const linkage = rows(file(out.files, "linkage.tsv"));
    expect(linkage).toHaveLength(out.sessions);
    expect(linkage.every((r) => r["study_code"] !== "n/a" && r["dashboard_session_id"] !== "n/a")).toBe(true);
  });

  it("keeps the linkage file out of what a BIDS validator reads", () => {
    expect(file(out.files, ".bidsignore")).toContain("linkage.*");
  });

  it("records a checksum for every file", () => {
    const manifest = JSON.parse(file(out.files, "export_manifest.json")) as { sha256: Record<string, string> };
    for (const f of out.files.filter((x) => x.path !== "export_manifest.json")) expect(manifest.sha256[f.path], f.path).toBe(hash(f.content));
  });

  it("zips every file", () => {
    const text = new TextDecoder("latin1").decode(out.zip);
    expect(text.startsWith("PK")).toBe(true);
    for (const f of out.files) expect(text).toContain(f.path);
  });

  it("says what was left out and flags the twin collision", () => {
    const readme = file(out.files, "README.md");
    expect(readme).toContain("Sittings not included");
    expect(readme).toContain("Unresolved code collisions");
    expect(readme).toContain("pseudonymous identifiers");
  });

  it("leaves free text out unless asked, and names the columns withheld", () => {
    const finish = file(out.files, "phenotype/demo_finish.tsv");
    expect(finish).not.toContain("future_message");
    expect(file(out.files, "README.md")).toContain("future_message");
    const withText = buildDashboardBids(input({ includeFreeText: true }));
    expect(file(withText.files, "phenotype/demo_finish.tsv")).toContain("future_message");
  });
});

describe("de-identified BIDS export", () => {
  const out = buildDashboardBids(input({ identifiers: false }));
  const codes = [...new Set(study.dataset.sessions.map((s) => s.participantId))];
  const studyCodes = [...new Set(sittings.map((s) => s.studyCode).filter(Boolean))] as string[];

  it("contains no participant code, study code, sitting id or device id anywhere", () => {
    const all = out.files.map((f) => f.content).join("\n");
    for (const c of codes) expect(all).not.toContain(c);
    for (const c of studyCodes) expect(all).not.toContain(c);
    for (const s of sittings) expect(all).not.toContain(s.sessionId);
    expect(out.files.some((f) => f.path.startsWith("linkage"))).toBe(false);
  });

  it("labels subjects P0001… and keeps only the day of each sitting", () => {
    const participants = rows(file(out.files, "participants.tsv"));
    expect(participants[0]!["participant_id"]).toBe("sub-P0001");
    const sessions = out.files.filter((f) => f.path.endsWith("/sessions.tsv")).flatMap((f) => rows(f.content));
    expect(sessions.every((s) => s["acq_time"]!.endsWith("T00:00:00.000Z"))).toBe(true);
  });

  it("pseudonymises consistently across files", () => {
    const { labels } = pseudonymiseDataset(study.dataset);
    expect(new Set(labels.values()).size).toBe(labels.size);
  });
});

describe("the real survey (v7.1.0) through the same pipeline", () => {
  // One synthetic sitting under the real release: every item answered with its
  // first option (or the smallest number), and a made-up secret code.
  const raw = release("7.1.0") as { hash: string; release: { key: string } };
  const idx = indexRelease(raw);
  const events: SittingEvent[] = [];
  let seq = 0;
  const at = (i: number) => new Date(Date.parse("2026-09-10T09:00:00.000Z") + i * 5000).toISOString();
  events.push({ seq: seq++, type: "session.started", tWall: at(0), tMono: 0 });
  const code: Record<string, unknown> = {
    "ybm_identity.ps_mother_initials": { kind: "text", value: "JA" },
    "ybm_identity.ps_house_digit": { kind: "text", value: "4" },
    "ybm_identity.ps_birth_month": { kind: "choice", code: 3 },
    "ybm_identity.ps_postcode_letters": { kind: "text", value: "CD" },
    "ybm_identity.dob": { kind: "date", iso: "2013-05-04" },
  };
  for (const q of idx.questions) {
    let value: unknown = code[q.key];
    if (value === undefined && !q.identifying) {
      if (q.responseType === "single_choice" && q.options?.length) value = { kind: "choice", code: q.options[0]!.code };
      else if (["numeric", "slider", "ladder"].includes(q.responseType)) value = { kind: "number", value: 1 };
    }
    if (value === undefined) continue;
    events.push({ seq: seq++, type: "item.presented", itemKey: q.key, tWall: at(seq), tMono: seq * 5000 });
    events.push({ seq: seq++, type: "response.recorded", itemKey: q.key, payload: { value }, tWall: at(seq), tMono: seq * 5000 });
  }
  events.push({ seq: seq++, type: "session.completed", payload: { totalMs: seq * 5000 }, tWall: at(seq), tMono: seq * 5000 });
  const sitting: Sitting = { sessionId: "01REALRELEASETEST0000000000", studyCode: "NDC0001", releaseKey: raw.release.key, releaseHash: raw.hash, startedAt: at(0), completedAt: at(seq), complete: true, events };
  const parsed = parseSurveyManifest(raw);
  const manifest = "manifest" in parsed ? parsed.manifest : null;
  const real = deriveStudyDataset({ study: "ybm", sittings: [sitting], manifests: new Map([[raw.hash, manifest!]]) });

  it("derives the participant code the survey would", () => {
    expect(real.excluded).toEqual([]);
    expect(real.dataset.sessions[0]!.participantId).toBe("JA403CD");
  });

  it("never exports the survey's own frozen scores: without the dashboard's schemes there are no score files", () => {
    // The survey scored the sitting with the definitions frozen into r7.1.0 …
    expect(real.dataset.scores.length).toBeGreaterThan(0);
    const out = buildDashboardBids(input({ study: "ybm", studyData: real, selected: new Set([sitting.sessionId]), sittings: new Map([[sitting.sessionId, sitting]]), manifest: manifest!, releaseVersions: new Map([[raw.hash, "7.1.0"]]) }));
    // … but scores leave only from the dashboard's schemes (docs/08 §8.5).
    expect(out.files.some((f) => f.path.startsWith("phenotype/scores."))).toBe(false);
    expect(file(out.files, "README.md")).toContain("No scores");
  });
});

describe("scoring the real survey with the dashboard's schemes", () => {
  const raw = release("7.1.0") as { hash: string };
  const idx = indexRelease(raw);
  // The same synthetic sitting as above: first option everywhere, born 4 May 2013.
  const parsed = parseSurveyManifest(raw);
  const manifest = "manifest" in parsed ? parsed.manifest : null;
  const sitting = (() => {
    const events: SittingEvent[] = [];
    let seq = 0;
    const at = (i: number) => new Date(Date.parse("2026-09-10T09:00:00.000Z") + i * 5000).toISOString();
    events.push({ seq: seq++, type: "session.started", tWall: at(0), tMono: 0 });
    const fixed: Record<string, unknown> = {
      "ybm_identity.ps_mother_initials": { kind: "text", value: "JA" },
      "ybm_identity.ps_house_digit": { kind: "text", value: "4" },
      "ybm_identity.ps_birth_month": { kind: "choice", code: 5 },
      "ybm_identity.ps_postcode_letters": { kind: "text", value: "CD" },
      "ybm_identity.dob": { kind: "date", iso: "2013-05-04" },
    };
    for (const q of idx.questions) {
      let value: unknown = fixed[q.key];
      if (value === undefined && !q.identifying) {
        if (q.responseType === "single_choice" && q.options?.length) value = { kind: "choice", code: q.options[0]!.code };
        else if (["numeric", "slider", "ladder"].includes(q.responseType)) value = { kind: "number", value: 1 };
      }
      if (value === undefined) continue;
      events.push({ seq: seq++, type: "item.presented", itemKey: q.key, tWall: at(seq), tMono: seq * 5000 });
      events.push({ seq: seq++, type: "response.recorded", itemKey: q.key, payload: { value }, tWall: at(seq), tMono: seq * 5000 });
    }
    events.push({ seq: seq++, type: "session.completed", payload: { totalMs: seq * 5000 }, tWall: at(seq), tMono: seq * 5000 });
    return { sessionId: "01REALSCORINGTEST000000000", studyCode: "NDC0001", releaseKey: "r", releaseHash: raw.hash, startedAt: at(0), completedAt: at(seq), complete: true, events } as Sitting;
  })();
  const data = deriveStudyDataset({ study: "ybm", sittings: [sitting], manifests: new Map([[raw.hash, manifest!]]) });
  const [scored] = scoreStudy(data, { schemes: DEFAULT_SCHEMES, releases: new Map([[raw.hash, idx]]), groups: DEFAULT_GROUP_SETTINGS });
  const value = (scheme: string, output: string) => scored!.scores[scheme]!.outputs[output]!.value;

  it("scores every instrument the release administers", () => {
    const administered = DEFAULT_SCHEMES.filter((s) => idx.questions.some((q) => q.instrument === s.instrument));
    expect(administered.map((s) => s.key)).not.toContain("sdq25_s18"); // the 18+ form arrives in r8.0.0
    expect(Object.keys(scored!.scores).sort()).toEqual(administered.map((s) => s.key).sort());
  });

  it("gives the official scores for these answers, including the ones the survey's own scoring leaves blank", () => {
    expect(value("swemwbs", "raw_total")).toBe(7);
    expect(value("swemwbs", "metric")).toBe(7);
    expect(value("stai5_s", "state_anxiety")).toBe(5);
    // SDQ all 'Not true' (0): only the reversed items score, 2 each.
    expect([value("sdq25_s", "emotional"), value("sdq25_s", "conduct"), value("sdq25_s", "hyperactivity"), value("sdq25_s", "peer"), value("sdq25_s", "total_difficulties")]).toEqual([0, 2, 4, 4, 10]);
    expect(value("rcads25", "total")).toBe(0);
    expect(value("ehi_sf", "lq")).toBe(100);
    expect(value("kss", "sleepiness")).toBe(1);
    expect(value("macarthur_ssy", "society")).toBe(1);
    expect(value("ybm_social_media", "hours_week")).toBeCloseTo(1.75);
    // The survey's own SWEMWBS and STAI-5 definitions name items q1…q7 that do not exist.
    const own = data.dataset.scores.filter((r) => r.instrument === "swemwbs" || r.instrument === "stai5_s");
    expect(own.every((r) => r.value === null)).toBe(true);
  });

  it("writes these scores, their bands and their methods into the BIDS export", () => {
    const out = buildDashboardBids(
      input({
        study: "ybm",
        studyData: data,
        selected: new Set([sitting.sessionId]),
        sittings: new Map([[sitting.sessionId, sitting]]),
        manifest: manifest!,
        releaseVersions: new Map([[raw.hash, "7.1.0"]]),
        scoring: { schemes: DEFAULT_SCHEMES, bySession: new Map([[sitting.sessionId, scored!.scores]]) },
      }),
    );
    const [row] = rows(file(out.files, "phenotype/scores.tsv"));
    expect(row!["swemwbs_metric"]).toBe("7");
    expect(row!["swemwbs_metric_warwick_bands"]).toBe("Probable depression");
    expect(row!["sdq25_s_total_difficulties"]).toBe("10");
    expect(row!["sdq25_s_total_difficulties_four_band"]).toBe("Close to average");
    const sidecar = JSON.parse(file(out.files, "phenotype/scores.json")) as Record<string, { Method?: string; Levels?: Record<string, string>; Verified?: unknown }>;
    expect(sidecar["swemwbs_metric"]!.Method).toContain("Rasch conversion");
    expect(sidecar["sdq25_s_total_difficulties_four_band"]!.Levels!["Very high"]).toBe("Total difficulties 20–40");
    expect(sidecar["swemwbs_metric"]!.Verified).toBe(false);
  });

  it("names phenotype columns by the codebook, keeping the survey and Qualtrics names and each version's codes in the sidecar", () => {
    const r4 = indexRelease(release("4.0.0"));
    const out = buildDashboardBids(
      input({ study: "ybm", studyData: data, selected: new Set([sitting.sessionId]), sittings: new Map([[sitting.sessionId, sitting]]), manifest: manifest!, releaseVersions: new Map([[raw.hash, "7.1.0"]]), releases: [r4, idx] }),
    );
    const header = file(out.files, "phenotype/sdq25_s.tsv").split("\n")[0]!.split("\t");
    expect(header).toContain("sdq_13_unhappy");
    expect(header).toContain("sdq_13_unhappy_status");
    expect(header.some((c) => c.startsWith("sdq25_q"))).toBe(false);
    const sdq = JSON.parse(file(out.files, "phenotype/sdq25_s.json")) as Record<string, Record<string, unknown>>;
    expect(sdq["sdq_13_unhappy"]).toMatchObject({ LongName: "SDQ 13: Often unhappy, down-hearted or tearful", SurveyVariable: "sdq25_q13", QualtricsVariable: "sdq_13", Levels: { "2": "Certainly True" } });
    expect(sdq["sdq_13_unhappy_status"]!["Description"]).toContain("sdq_13_unhappy");
    const sm = JSON.parse(file(out.files, "phenotype/ybm_social_media.json")) as Record<string, Record<string, unknown>>;
    expect(sm["sm_bout_tiktok"]!["LevelsByVersion"]).toEqual({
      "r4.0.0": expect.objectContaining({ "1": "0 minutes" }),
      "r7.1.0": expect.objectContaining({ "1": "I have it but barely use it" }),
    });
    expect(sm["sm_time_school_day"]!["LevelsByVersion"]).toBeDefined();
    expect(sm["sm_overuse"]!["LevelsByVersion"]).toBeUndefined();
  });

  it("places the sitting in its school and, from the date of birth, its year group — without keeping the date", () => {
    expect(scored).toMatchObject({ school: "NDC", yearGroup: 9, yearGroupSource: "dob" });
    expect(JSON.stringify(data.dataset)).not.toContain("2013-05-04");
  });
});

describe("the demo study's standard measures", () => {
  const scored = scoreStudy(study, { schemes: DEFAULT_SCHEMES, releases: new Map(demo.map((r) => [r.index.hash, r.index])), groups: DEFAULT_GROUP_SETTINGS });
  const view = buildScoresView(scored, { schemes: DEFAULT_SCHEMES, settings: DEFAULT_GROUP_SETTINGS, observation: "latest", groupBy: "school", now: new Date() });
  const result = (scheme: string, output: string) => view.results.find((r) => r.scheme === scheme && r.output === output)!;

  it("are scored for every sitting that reached them, with year groups from the year-group question", () => {
    const swemwbs = result("swemwbs", "metric");
    expect(swemwbs.overall!.n).toBeGreaterThan(25);
    expect(scored.filter((s) => s.yearGroup !== null).every((s) => s.yearGroupSource === "item")).toBe(true);
    expect(view.available.yearGroups.length).toBeGreaterThan(2);
  });

  it("show the school differences the demo was built with", () => {
    const bySchool = Object.fromEntries(result("swemwbs", "metric").groups.map((g) => [g.key, g.summary!.mean]));
    expect(bySchool["NDC"]).toBeGreaterThan(bySchool["BRD"]!);
    const sdq = Object.fromEntries(result("sdq25_s", "total_difficulties").groups.map((g) => [g.key, g.summary!.mean]));
    expect(sdq["NDC"]).toBeLessThan(sdq["BRD"]!);
  });
});

describe("the Participants page", () => {
  const facts = (id: string) => {
    const s = sittings.find((x) => x.sessionId === id);
    return s ? { status: "complete" as const, releaseVersion: "1.0.0", site: s.studyCode?.slice(0, 3) ?? null, startedAt: s.startedAt ?? null } : undefined;
  };
  const now = new Date("2026-09-29T10:00:00.000Z");
  const shown = participantsOverview(study, facts, { codesShown: true, now });

  it("lists every linked sitting under its participant, in wave order", () => {
    expect(shown.totals.participants).toBe(study.dataset.participants.length);
    expect(shown.participants.reduce((n, p) => n + p.sittings.length, 0)).toBe(study.dataset.sessions.length);
    for (const p of shown.participants) expect(p.sittings.map((s) => s.wave)).toEqual([...p.sittings.map((s) => s.wave)].sort((a, b) => a - b));
    const multi = shown.participants.find((p) => p.waves > 1)!;
    expect(multi.sittings[1]!.daysSincePrevious).toBeGreaterThan(0);
    expect(shown.totals.multiWave).toBe(shown.participants.filter((p) => p.waves > 1).length);
  });

  it("accounts for every sitting: linked or held back with a reason", () => {
    expect(shown.totals.linkedSittings + shown.totals.heldBack).toBe(sittings.length);
    expect(shown.heldBack.every((h) => h.reason.length > 0)).toBe(true);
  });

  it("flags the code two children share, and their sittings a day apart", () => {
    expect(shown.sharedCodes).toHaveLength(1);
    const twin = shown.participants.find((p) => p.code === shown.sharedCodes[0]!.code)!;
    expect(twin.attention).toEqual(expect.arrayContaining(["shared_code", "same_day"]));
    expect(shown.totals.sameDay).toBeGreaterThanOrEqual(1);
  });

  it("shows labels, never codes, to roles that may not see them", () => {
    const masked = participantsOverview(study, facts, { codesShown: false, now });
    const text = JSON.stringify(masked);
    for (const p of study.dataset.participants) expect(text).not.toContain(p.participantId);
    expect(masked.participants[0]!.code).toBe("P0001");
    expect(masked.sharedCodes[0]!.code).toMatch(/^P\d{4}$/);
  });
});

/**
 * Made-up sittings under a real survey version, scored by the survey's own
 * reading (vendored ingest, the version's frozen definitions) and by the
 * dashboard's schemes. Every question answered at
 * random (a fixed seed), one in sixteen left unanswered, so the missing-data
 * rules are compared too. Never real data.
 */
function crossCheck(version: string) {
  const raw = release(version) as { hash: string };
  const idx = indexRelease(raw);
  const parsed = parseSurveyManifest(raw);
  const manifest = "manifest" in parsed ? parsed.manifest : null;
  let seed = 49;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sittings: Sitting[] = Array.from({ length: 40 }, (_, n) => {
    const events: SittingEvent[] = [];
    let seq = 0;
    const at = (i: number) => new Date(Date.parse("2026-10-05T09:00:00.000Z") + n * 3_600_000 + i * 5000).toISOString();
    events.push({ seq: seq++, type: "session.started", tWall: at(0), tMono: 0 });
    const code: Record<string, unknown> = {
      "ybm_identity.ps_mother_initials": { kind: "text", value: String.fromCharCode(65 + (n % 26)) + "Q" },
      "ybm_identity.ps_house_digit": { kind: "text", value: String(n % 10) },
      "ybm_identity.ps_birth_month": { kind: "choice", code: 1 + (n % 12) },
      "ybm_identity.ps_postcode_letters": { kind: "text", value: "ZZ" },
      // Alternately 14 and 21 on the day, so from r8.0.0 both SDQ forms are given (D-51).
      "ybm_identity.dob": { kind: "date", iso: n % 2 === 0 ? "2012-03-10" : "2005-03-10" },
      // From r8.0.0 the participant ID comes from name and date of birth (D-52).
      "ybm_identity.first_name": { kind: "text", value: `Cross${String.fromCharCode(65 + (n % 26))}${n}` },
      "ybm_identity.last_name": { kind: "text", value: "Check" },
      // The home address, r8.0.0 on — with the trailing space a tablet keyboard leaves.
      "ybm_identity.home_address": { kind: "fields", values: { postcode: "LS6 2AA ", house: String(n + 1), street: "Hyde Park Road" } },
    };
    // Asked as a device would: only what the survey's display conditions show.
    const store = new AnswerStore();
    for (const q of idx.questions) {
      if (q.displayIf && !evaluate(q.displayIf, store, new Date(at(0)))) continue;
      let value: unknown = code[q.key];
      if (value === undefined && !q.identifying && random() >= 1 / 16) {
        if (q.responseType === "single_choice" && q.options?.length) value = { kind: "choice", code: q.options[Math.floor(random() * q.options.length)]!.code };
      }
      if (value === undefined) continue;
      const [instrument = "", item = ""] = q.key.split(".");
      store.set({ instrument, item, revision: 1 }, { status: "answered", value: value as AnswerValue });
      events.push({ seq: seq++, type: "item.presented", itemKey: q.key, tWall: at(seq), tMono: seq * 5000 });
      events.push({ seq: seq++, type: "response.recorded", itemKey: q.key, payload: { value }, tWall: at(seq), tMono: seq * 5000 });
    }
    events.push({ seq: seq++, type: "session.completed", payload: { totalMs: seq * 5000 }, tWall: at(seq), tMono: seq * 5000 });
    return { sessionId: `01CROSSCHECK${String(n).padStart(14, "0")}`, studyCode: "ZZZ0001", releaseKey: "r", releaseHash: raw.hash, startedAt: at(0), completedAt: at(seq), complete: true, events };
  });
  const data = deriveStudyDataset({ study: "ybm", sittings, manifests: new Map([[raw.hash, manifest!]]) });
  const dashboard = new Map(scoreStudy(data, { schemes: DEFAULT_SCHEMES, releases: new Map([[raw.hash, idx]]), groups: DEFAULT_GROUP_SETTINGS }).map((s) => [s.sessionId, s.scores]));
  const survey = (key: string, output: string) => data.dataset.scores.filter((r) => r.scoringKey === key && r.output === output);
  const ours = (sessionId: string, scheme: string, output: string) => dashboard.get(sessionId)?.[scheme]?.outputs[output]?.value ?? null;
  return { data, sittings, survey, ours };
}

describe("the survey's own scores under r7.2.0 agree with the dashboard's", () => {
  const { data, sittings, survey, ours } = crossCheck("7.2.0");

  const same: [string, string, string, string][] = [
    ["score.swemwbs", "raw_total", "swemwbs", "raw_total"],
    ["score.stai5", "state_anxiety", "stai5_s", "state_anxiety"],
    ["score.sdq25_s", "emotional", "sdq25_s", "emotional"],
    ["score.sdq25_s", "conduct", "sdq25_s", "conduct"],
    ["score.sdq25_s", "hyperactivity", "sdq25_s", "hyperactivity"],
    ["score.sdq25_s", "peer", "sdq25_s", "peer"],
    ["score.sdq25_s", "prosocial", "sdq25_s", "prosocial"],
    ["score.ehi_sf", "lq", "ehi_sf", "lq"],
    // The survey's reading once hid subscales from the step that totals them (S7, fixed).
    ["score.sdq25_s", "total_difficulties", "sdq25_s", "total_difficulties"],
    ["score.rcads25", "total", "rcads25", "total"],
  ];

  it.each(same)("%s %s equals the dashboard's %s %s, sitting by sitting", (key, output, scheme, ourOutput) => {
    const rows = survey(key, output);
    expect(rows).toHaveLength(sittings.length);
    // Some scored and some blank, so both the arithmetic and the missing-data rule are compared.
    expect(rows.some((r) => r.value !== null)).toBe(true);
    for (const r of rows) expect(ours(r.sessionId, scheme, ourOutput), `${r.sessionId} ${key} ${output}`).toBe(r.value);
  });

  it("RCADS subscales differ before r7.3.0: the survey counted item 18 as depression and 24 as anxiety, the published key the reverse (S8)", () => {
    const code = (sessionId: string, item: string) => data.dataset.responses.find((r) => r.sessionId === sessionId && r.instrument === "rcads25" && r.item === item)?.value ?? null;
    let compared = 0;
    for (const r of survey("score.rcads25", "depression")) {
      const theirAnxiety = survey("score.rcads25", "anxiety").find((x) => x.sessionId === r.sessionId)!.value as number | null;
      const [q18, q24] = [code(r.sessionId, "q18"), code(r.sessionId, "q24")];
      const ourDepression = ours(r.sessionId, "rcads25", "depression");
      const ourAnxiety = ours(r.sessionId, "rcads25", "anxiety");
      if (r.value === null || theirAnxiety === null || q18 === null || q24 === null) continue;
      compared += 1;
      expect(ourDepression).toBe((r.value as number) - q18 + q24);
      expect(ourAnxiety).toBe(theirAnxiety + q18 - q24);
      expect(ours(r.sessionId, "rcads25", "total")).toBe((r.value as number) + theirAnxiety);
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("the survey's SWEMWBS and STAI-5 definitions are the fixed ones", () => {
    expect(new Set([...survey("score.swemwbs", "raw_total"), ...survey("score.stai5", "state_anxiety")].map((r) => r.scoringVersion))).toEqual(new Set(["1.0.1"]));
  });

  it("BIS/BAS differ by design: the survey sums the raw codes, the dashboard reverses them so higher means more of the trait", () => {
    const pairs: [string, string][] = [["bis_raw", "bis"], ["bas_reward_raw", "bas_reward"], ["bas_drive_raw", "bas_drive"]];
    for (const [theirs, mine] of pairs) {
      const rows = survey("score.bisbas12_ybm", theirs);
      expect(rows.some((r) => r.value !== null)).toBe(true);
      // Four items coded 1–4, each reversed as 5 − code: the dashboard's score is 20 − the survey's.
      for (const r of rows) expect(ours(r.sessionId, "bisbas12_ybm", mine)).toBe(r.value === null ? null : 20 - (r.value as number));
    }
  });
});

describe("the survey's own scores under r7.3.0 agree with the dashboard's, RCADS included", () => {
  const { sittings, survey, ours } = crossCheck("7.3.0");
  it.each([
    ["score.rcads25", "depression", "rcads25", "depression"],
    ["score.rcads25", "anxiety", "rcads25", "anxiety"],
    ["score.rcads25", "total", "rcads25", "total"],
    ["score.sdq25_s", "total_difficulties", "sdq25_s", "total_difficulties"],
  ])("%s %s equals the dashboard's %s %s", (key, output, scheme, ourOutput) => {
    const rows = survey(key, output);
    expect(rows).toHaveLength(sittings.length);
    expect(rows.some((r) => r.value !== null)).toBe(true);
    for (const r of rows) expect(ours(r.sessionId, scheme, ourOutput), `${r.sessionId} ${key} ${output}`).toBe(r.value);
  });
});

describe("the SDQ by age under r8.0.0 (D-51)", () => {
  const { data, sittings, survey, ours } = crossCheck("8.0.0");
  const idx = indexRelease(release("8.0.0"));
  const adult = (n: number) => n % 2 === 1;
  const answered = (s: Sitting, instrument: string) =>
    s.events.some((e) => e.type === "response.recorded" && e.itemKey?.startsWith(`${instrument}.`));

  it("gives each sitting one SDQ form, the one for the participant's age on the day", () => {
    sittings.forEach((s, n) => {
      expect(answered(s, "sdq25_s18"), s.sessionId).toBe(adult(n));
      expect(answered(s, "sdq25_s"), s.sessionId).toBe(!adult(n));
    });
  });

  it("scores the 18+ form exactly as the survey does, sitting by sitting, and bands none of it", () => {
    let compared = 0;
    for (const output of ["emotional", "conduct", "hyperactivity", "peer", "prosocial", "total_difficulties"]) {
      for (const row of survey("score.sdq25_s18", output)) {
        expect(ours(row.sessionId, "sdq25_s18", output), `${row.sessionId} ${output}`).toBe(row.value);
        if (row.value !== null) compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40);
    const scheme = DEFAULT_SCHEMES.find((x) => x.key === "sdq25_s18")!;
    expect(scheme.outputs.every((o) => (o.thresholds ?? []).length === 0 && (o.benchmarks ?? []).length === 0)).toBe(true);
    void data;
  });

  it("scores the 11–17 form as the survey does, with its revised items 19, 20 and 22", () => {
    for (const output of ["peer", "prosocial", "conduct", "total_difficulties"]) {
      const rows = survey("score.sdq25_s", output).filter((r) => r.value !== null);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(ours(row.sessionId, "sdq25_s", output), `${row.sessionId} ${output}`).toBe(row.value);
    }
    expect(idx.byKey.get("sdq25_s.q20")!.text).toBe("I often volunteer to help others (parents, teachers, children)");
  });

  it("counts the form not given as not shown, never as missing, judging age on the day the sitting started", () => {
    const assess = (n: number, sittingStart: string | null) =>
      assessSitting(replaySitting(sittings[n]!), idx, { requiredLevels: ["hard", "soft"], sittingStart });
    const outcome = (a: ReturnType<typeof assess>, key: string) => a.outcomes.find((o) => o.key === key)!.outcome;
    const start = (n: number) => sittings[n]!.startedAt!;
    const grown = assess(1, start(1));
    expect(outcome(grown, "sdq25_s.q1")).toBe("hidden_branching");
    expect(grown.missingRequiredKeys.filter((k) => k.startsWith("sdq25_s."))).toEqual([]);
    const young = assess(0, start(0));
    expect(outcome(young, "sdq25_s18.q1")).toBe("hidden_branching");
    expect(young.missingRequiredKeys.filter((k) => k.startsWith("sdq25_s18."))).toEqual([]);
    // Without the sitting's start the age rule cannot hold, as on the device: the
    // adult's 18+ answers would then read as answered-but-hidden.
    expect(outcome(assess(1, null), "sdq25_s18.q1")).toBe("answered_hidden");
  });
});

describe("the home address and the name-derived ID under r8.0.0 (D-52)", () => {
  const { data, sittings } = crossCheck("8.0.0");
  const raw = release("8.0.0") as { hash: string };
  const idx = indexRelease(raw);
  const parsed = parseSurveyManifest(raw);
  const manifest = "manifest" in parsed ? parsed.manifest : null;

  it("links every sitting under an ID made from name and date of birth, with none held back", () => {
    expect(data.excluded).toEqual([]);
    expect(data.dataset.sessions).toHaveLength(sittings.length);
    for (const s of data.dataset.sessions) expect(s.participantId).toMatch(/^P[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(new Set(data.dataset.sessions.map((s) => s.participantId)).size).toBe(sittings.length);
  });

  it("accepts the address as the device did, trailing space and all", () => {
    const a = assessSitting(replaySitting(sittings[0]!), idx, { requiredLevels: ["hard", "soft"], sittingStart: sittings[0]!.startedAt! });
    expect(a.invalidKeys).not.toContain("ybm_identity.home_address");
    expect(a.outcomes.find((o) => o.key === "ybm_identity.home_address")!.outcome).toBe("answered");
    expect(idx.byKey.get("ybm_identity.home_address")).toMatchObject({ identifying: true, name: "home_address" });
  });

  it("never lets the address or a name into the research export", () => {
    const out = buildDashboardBids(
      input({
        study: "ybm",
        studyData: data,
        selected: new Set(sittings.map((s) => s.sessionId)),
        sittings: new Map(sittings.map((s) => [s.sessionId, s])),
        manifest: manifest!,
        releaseVersions: new Map([[raw.hash, "8.0.0"]]),
      }),
    );
    const everything = out.files.map((f) => f.content).join("\n");
    expect(everything).not.toContain("Hyde Park Road");
    expect(everything).not.toContain("LS6 2AA");
    expect(everything).not.toMatch(/CrossA0|home_address/);
    // the participant ID is there, as a pseudonym
    expect(everything).toMatch(/P[0-9A-HJKMNP-TV-Z]{10}/);
  });
});

