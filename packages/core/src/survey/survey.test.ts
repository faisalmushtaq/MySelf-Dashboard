import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indexRelease } from "../manifest.js";
import type { Sitting, SittingEvent } from "../types.js";
import { demoReleases, generateDemoSittings } from "../node/synthetic.js";
import { buildDashboardBids, deriveStudyDataset, parseSurveyManifest, participantsOverview, pseudonymiseDataset, scoreStudy, subsetDataset, type BidsExportInput } from "./index.js";
import { DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES } from "../scoring/index.js";

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
    for (const v of ["1.0.0", "4.0.0", "5.0.0", "7.1.0"]) {
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

  it("scores the survey's measures and writes them to phenotype/scores.tsv", () => {
    expect(real.dataset.scores.length).toBeGreaterThan(0);
    const out = buildDashboardBids(input({ study: "ybm", studyData: real, selected: new Set([sitting.sessionId]), sittings: new Map([[sitting.sessionId, sitting]]), manifest: manifest!, releaseVersions: new Map([[raw.hash, "7.1.0"]]) }));
    const scores = rows(file(out.files, "phenotype/scores.tsv"));
    expect(scores).toHaveLength(1);
    expect(Object.keys(scores[0]!).some((k) => k.startsWith("swemwbs_"))).toBe(true);
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
    expect(Object.keys(scored!.scores).sort()).toEqual(DEFAULT_SCHEMES.map((s) => s.key).sort());
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

  it("places the sitting in its school and, from the date of birth, its year group — without keeping the date", () => {
    expect(scored).toMatchObject({ school: "NDC", yearGroup: 9, yearGroupSource: "dob" });
    expect(JSON.stringify(data.dataset)).not.toContain("2013-05-04");
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
