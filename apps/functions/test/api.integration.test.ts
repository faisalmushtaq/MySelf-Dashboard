import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DEFAULT_FILTERS, type AnalyticsResponse, type CodebookResponse, type ParticipantsResponse, type ResearcherViewResponse, type QuerySessionsResponse, type ScoresView, type ScoringSettingsView, type SessionDetailResponse, type SurveyVersionsResponse } from "@myself-dashboard/core";
import { contentHash, demoManifest } from "@myself-dashboard/core/node";
import { anonymousDevice, demoManifests, person, req, resetEmulators, seedSittings, type Person } from "./support.js";
import { pdfText } from "./pdfText.js";

import { dash } from "../src/env.js";
import { registerRelease, resetStudioCache } from "../src/releases.js";
import { summariseSitting } from "../src/summaries.js";
import { handleOpsRequest } from "../src/ops.js";
import { invalidateSettings } from "../src/settings.js";
import { resetStore } from "../src/store.js";
import { whoAmI } from "../src/api/access.js";
import { getSessionDetail, querySessions } from "../src/api/sessions.js";
import { getAnalytics, getQuestionAnalytics, getQuestionHistory, getResearcherView } from "../src/api/analytics.js";
import { addNote, updateReview } from "../src/api/review.js";
import { logFigureExport, setDashboardRole, updateAccessPolicy, getSettings } from "../src/api/admin.js";
import { createExport, downloadExport, expireExports, previewExport } from "../src/api/exports.js";
import { getCodebook } from "../src/api/codebook.js";
import { getParticipants } from "../src/api/participants.js";
import { getScores, getScoringSettings, saveGroupSettings, saveScoringScheme } from "../src/api/scores.js";
import { invalidateScoring } from "../src/scoring.js";
import { exportSurveyProvenance, getSurveyManifest, listSurveyVersions } from "../src/api/versions.js";

/**
 * The backend, end to end against the emulators: real ID tokens from the Auth
 * emulator, both Firestore databases, Storage. Every handler is called exactly
 * as the Functions runtime calls it.
 */

let admin: Person;
let researcher: Person;
let reviewer: Person;
let stranger: Person;
let noRole: Person;
let device: Person;
let sittings: Awaited<ReturnType<typeof seedSittings>>;

const run = <T>(fn: { run: (r: never) => unknown }, who: Person | null, data: unknown): Promise<T> => Promise.resolve(fn.run(req(who, data) as never)) as Promise<T>;

async function auditRows(action: string) {
  const snap = await dash().collection("studies/demo/auditLog").where("action", "==", action).get();
  return snap.docs.map((d) => d.data());
}

beforeAll(async () => {
  await resetEmulators();
  invalidateSettings();
  resetStore();
  await dash().doc("config/access").set({ emails: ["brainpopresearch@gmail.com"], domains: ["brainpop.example"] });
  for (const m of demoManifests()) await registerRelease(m, "demo", "test");
  sittings = await seedSittings();
  for (const s of sittings) await summariseSitting(s.doc.sessionId, s.doc as never, { backfill: true });
  admin = await person("brainpopresearch@gmail.com", "owner");
  researcher = await person("researcher@brainpop.example", "researcher");
  reviewer = await person("reviewer@brainpop.example", "analyst");
  stranger = await person("stranger@gmail.com", "owner");
  noRole = await person("newcomer@brainpop.example", null);
  device = await anonymousDevice();
}, 120_000);

describe("authentication and authorisation", () => {
  it("tells an authorised administrator what they may do", async () => {
    const me = await run<{ authorised: boolean; role: string; capabilities: string[] }>(whoAmI, admin, { signIn: true });
    expect(me.authorised).toBe(true);
    expect(me.role).toBe("owner");
    expect(me.capabilities).toContain("settings.access");
    expect((await auditRows("auth.signed_in")).some((r) => r["actorEmail"] === "brainpopresearch@gmail.com")).toBe(true);
  });

  it("denies an unapproved Google account, explains why, and audits it", async () => {
    const me = await run<{ authorised: boolean; reason: string }>(whoAmI, stranger, {});
    expect(me.authorised).toBe(false);
    expect(me.reason).toMatch(/not an approved BrainPOP Research account/);
    expect((await auditRows("auth.denied")).some((r) => r["actorEmail"] === "stranger@gmail.com")).toBe(true);
    await expect(run(querySessions, stranger, {})).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an approved account without a role, anonymous devices, and nobody at all", async () => {
    expect((await run<{ reason: string }>(whoAmI, noRole, {})).reason).toMatch(/has not been given a dashboard role/);
    await expect(run(querySessions, device, {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(querySessions, null, {})).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("sessions", () => {
  it("lists, filters and pages on the server", async () => {
    const all = await run<QuerySessionsResponse>(querySessions, researcher, { filters: DEFAULT_FILTERS, page: 1, pageSize: 25 });
    expect(all.items.length).toBeLessThanOrEqual(25);
    expect(all.total).toBeGreaterThan(25);
    const incomplete = await run<QuerySessionsResponse>(querySessions, researcher, { filters: { ...DEFAULT_FILTERS, statuses: ["incomplete"] }, pageSize: 100 });
    expect(incomplete.items.every((i) => i.status.lifecycle === "incomplete")).toBe(true);
  });

  it("masks study codes for read-only reviewers, and their searches cannot find codes", async () => {
    const r = await run<QuerySessionsResponse>(querySessions, reviewer, { filters: DEFAULT_FILTERS, pageSize: 100 });
    expect(r.items.every((i) => i.studyCodeMasked && (i.studyCode === null || i.studyCode.includes("•")))).toBe(true);
    const code = sittings.find((s) => s.scenario === "complete")!.doc.studyCode!;
    expect((await run<QuerySessionsResponse>(querySessions, reviewer, { filters: DEFAULT_FILTERS, search: code })).total).toBe(0);
    expect((await run<QuerySessionsResponse>(querySessions, researcher, { filters: DEFAULT_FILTERS, search: code })).total).toBe(1);
  });

  it("shows a session in its own version's wording, never an identifying answer, and free text only when permitted", async () => {
    const s = sittings.find((x) => x.scenario === "complete" && x.doc.releaseHash === demoManifests()[0]!["hash"])!;
    const asResearcher = await run<SessionDetailResponse>(getSessionDetail, researcher, { sessionId: s.doc.sessionId });
    const answers = asResearcher.answers!.flatMap((sec) => sec.answers);
    expect(asResearcher.release?.version).toBe("1.0.0");
    expect(answers.find((a) => a.key === "demo_sleep.sleep_quality")!.text).toBe("How well did you sleep last night?");
    const name = answers.find((a) => a.key === "demo_about.first_name")!;
    expect(name.answer).toMatchObject({ display: null, redacted: "identifying" });
    expect(JSON.stringify(asResearcher)).not.toMatch(/"(Alex|Sam|Jordan|Riley|Casey|Morgan)"/);
    expect(answers.find((a) => a.key === "demo_finish.future_message")!.answer.redacted).toBeNull();
    expect(asResearcher.notInVersion.map((q) => q.key)).toContain("demo_about.school_travel");

    const asReviewer = await run<SessionDetailResponse>(getSessionDetail, reviewer, { sessionId: s.doc.sessionId });
    expect(asReviewer.answers!.flatMap((sec) => sec.answers).find((a) => a.key === "demo_finish.future_message")!.answer).toMatchObject({ display: null, redacted: "free_text" });
    expect(asReviewer.permissions).toEqual({ review: false, freeText: false, studyCode: false });
    expect((await auditRows("session.viewed")).filter((r) => (r["target"] as { id: string }).id === s.doc.sessionId)).toHaveLength(2);
  });

  it("previous / next follow the filtered, sorted list", async () => {
    const context = { filters: { ...DEFAULT_FILTERS, statuses: ["complete"] }, sort: { key: "startedAt", dir: "asc" }, search: "", pageSize: 25 };
    const list = await run<QuerySessionsResponse>(querySessions, researcher, { ...context, page: 1, pageSize: 100 });
    const second = list.items[1]!.sessionId;
    const d = await run<SessionDetailResponse>(getSessionDetail, researcher, { sessionId: second, context });
    expect(d.neighbours).toMatchObject({ position: 2, total: list.total, previousId: list.items[0]!.sessionId, nextId: list.items[2]!.sessionId });
  });

  it("refuses a session id that is not an id", async () => {
    await expect(run(getSessionDetail, researcher, { sessionId: "../../etc" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(run(getSessionDetail, researcher, { sessionId: "01JNOPE" })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("review tools", () => {
  it("a read-only reviewer cannot flag, note or change status", async () => {
    const id = sittings[0]!.doc.sessionId;
    await expect(run(updateReview, reviewer, { sessionId: id, change: { kind: "add_flag", reason: "speeding" }, expectedRev: 0 })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(addNote, reviewer, { sessionId: id, text: "hello" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("a researcher's flag and note are stored apart from the response, with an audit trail", async () => {
    const s = sittings.find((x) => x.scenario === "incomplete_skips")!;
    const id = s.doc.sessionId;
    const { review } = await run<{ review: { rev: number; status: string; flags: unknown[] } }>(updateReview, researcher, { sessionId: id, change: { kind: "add_flag", reason: "speeding", note: "very quick" }, expectedRev: 0 });
    expect(review).toMatchObject({ rev: 1, status: "needs_review" });
    await run(addNote, researcher, { sessionId: id, text: "Spoke to the site lead; keep." });
    const audit = await dash().collection("studies/demo/auditLog").where("target.id", "==", id).get();
    expect(audit.docs.map((d) => d.data()["action"]).sort()).toEqual(expect.arrayContaining(["note.added", "review.updated"]));
    // The participant's sitting is untouched.
    const raw = await getFirestore().doc(`studies/demo/sessions/${id}`).get();
    expect(raw.data()).toEqual(JSON.parse(JSON.stringify(s.doc)));
    const detail = await run<SessionDetailResponse>(getSessionDetail, researcher, { sessionId: id });
    expect(detail.notes.map((n) => n.text)).toEqual(["Spoke to the site lead; keep."]);
    expect(detail.item.status.markers).toContain("needs_review");
  });

  it("refuses a change based on a stale revision", async () => {
    const id = sittings.find((x) => x.scenario === "incomplete_skips")!.doc.sessionId;
    await expect(run(updateReview, researcher, { sessionId: id, change: { kind: "set_status", status: "reviewed" }, expectedRev: 0 })).rejects.toMatchObject({ code: "aborted" });
  });

  it("flagged sessions are findable at once", async () => {
    const flagged = await run<QuerySessionsResponse>(querySessions, reviewer, { filters: { ...DEFAULT_FILTERS, flagged: "flagged" } });
    expect(flagged.total).toBe(1);
  });
});

describe("analytics", () => {
  it("overview metrics add up", async () => {
    const r = await run<{ analytics: { metrics: Record<string, number> }; releases: unknown[]; freshness: { summaryCount: number } }>(getAnalytics, reviewer, { filters: DEFAULT_FILTERS });
    const m = r.analytics.metrics;
    expect(m["complete"]! + m["incomplete"]! + m["abandoned"]! + m["inProgress"]! + m["notStarted"]!).toBe(m["started"]);
    expect(r.releases).toHaveLength(3);
    expect(r.freshness.summaryCount).toBe(sittings.length);
  });

  it("gives the survey researcher view's figures for the same filters, counted by its own rules", async () => {
    const { analytics } = await run<AnalyticsResponse>(getAnalytics, reviewer, { filters: DEFAULT_FILTERS });
    const v = await run<ResearcherViewResponse>(getResearcherView, reviewer, { filters: DEFAULT_FILTERS });
    const m = analytics.metrics;
    expect(v.figures.sittings).toBe(m.started);
    expect(v.figures.reachedEnd).toBe(m.reachedEnd);
    expect(v.figures.allRequiredAnswered).toBe(m.allRequiredAnswered);
    expect(v.figures.finishedOrAbandoned).toBe(m.completionRateDenominator);
    expect([v.quarantined, v.unreadable]).toEqual([m.quarantined, m.unreadable]);
    expect(v.figures.participants).toBeGreaterThan(30);
    expect(v.figures.linked + v.figures.notLinked).toBe(v.figures.sittings);
    // Aggregates only: no participant code, study code or sitting id leaves the server.
    expect(JSON.stringify(v)).not.toMatch(/[A-Z]{2}[0-9]{3}[A-Z]{2}|ses_/);
    await expect(run(getResearcherView, stranger, { filters: DEFAULT_FILTERS })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("question analysis is for one version; history covers all", async () => {
    const [v1, v11, v2] = demoManifests();
    const q = await run<{ stats: { key: string }[]; comparison: { added: { key: string }[] } }>(getQuestionAnalytics, reviewer, { filters: DEFAULT_FILTERS, versionHash: v2!["hash"], compareWith: v11!["hash"] });
    expect(q.stats.map((s) => s.key)).toContain("demo_about.school_travel");
    expect(q.comparison.added.map((a) => a.key)).toEqual(["demo_about.school_travel"]);
    const h = await run<{ entries: { version: string; present: boolean }[] }>(getQuestionHistory, reviewer, { key: "demo_wellbeing.wb6" });
    expect(h.entries.map((e) => e.present)).toEqual([false, true, true]);
    void v1;
  });
});

describe("exports", () => {
  it("previews what an export would contain, and says when a role may not create it", async () => {
    const spec = { kind: "sessions", format: "csv", scope: "filtered", filters: { ...DEFAULT_FILTERS, statuses: ["incomplete"] }, includeAnswers: true };
    const p = await run<{ allowed: boolean; sessionCount: number; refusal: string | null; fileName: string }>(previewExport, reviewer, spec);
    expect(p.allowed).toBe(false);
    expect(p.refusal).toMatch(/summaries, not session-level/);
    const ok = await run<{ allowed: boolean; sessionCount: number; fileName: string }>(previewExport, researcher, spec);
    expect(ok.allowed).toBe(true);
    expect(ok.sessionCount).toBeGreaterThan(0);
    expect(ok.fileName).toMatch(/^myself_sessions-filtered_all-time_created-\d{8}-\d{4}\.csv$/);
  });

  it("refuses a reviewer's session-level export on the server, and audits the refusal", async () => {
    await expect(run(createExport, reviewer, { kind: "sessions", format: "csv", scope: "all" })).rejects.toMatchObject({ code: "permission-denied" });
    expect((await auditRows("export.created")).some((r) => r["outcome"] === "denied" && r["actorEmail"] === "reviewer@brainpop.example")).toBe(true);
  });

  it("generates an authorised export privately, and serves it only to its requester", async () => {
    const job = await run<{ id: string; status: string; fileName: string; rowCount: number }>(createExport, researcher, {
      kind: "sessions",
      format: "csv",
      scope: "filtered",
      filters: { ...DEFAULT_FILTERS, statuses: ["incomplete"] },
      includeAnswers: true,
      includeFreeText: true,
    });
    expect(job.status).toBe("ready");
    const jobDoc = (await dash().doc(`studies/demo/exportJobs/${job.id}`).get()).data()!;
    const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
    const csv = bytes.toString("utf8");
    expect(csv.startsWith("﻿session_id,")).toBe(true);
    expect(csv).not.toMatch(/(^|,)first_name/m);
    expect(csv).not.toMatch(/,(Alex|Sam|Jordan|Riley|Casey|Morgan),/);
    expect((await auditRows("export.created")).some((r) => (r["target"] as { id: string } | null)?.id === job.id)).toBe(true);

    const researcherDownload = await download(job.id, researcher);
    expect(researcherDownload.status).toBe(200);
    expect(researcherDownload.headers["content-disposition"]).toContain(job.fileName);
    expect(researcherDownload.body.toString("utf8")).toBe(csv);
    expect((await download(job.id, reviewer)).status).toBe(403);
    expect((await download(job.id, admin)).status).toBe(200);
    expect((await download(job.id, null)).status).toBe(401);
    expect((await auditRows("export.downloaded")).length).toBeGreaterThanOrEqual(2);
    expect((await auditRows("export.download_denied")).length).toBeGreaterThanOrEqual(1);

    // After the retention period the file is gone and the link is dead.
    await dash().doc(`studies/demo/exportJobs/${job.id}`).update({ expiresAt: new Date(Date.now() - 1000) });
    expect(await expireExports()).toBeGreaterThanOrEqual(1);
    const [exists] = await getStorage().bucket().file(jobDoc["storagePath"]).exists();
    expect(exists).toBe(false);
    expect((await download(job.id, researcher)).status).toBe(409);
  });

  it("exports a BIDS dataset with identifiers by default, built the survey's way", async () => {
    const job = await run<{ id: string; status: string; fileName: string; rowCount: number }>(createExport, researcher, { kind: "sessions", format: "bids", scope: "all" });
    expect(job.status).toBe("ready");
    expect(job.fileName).toMatch(/_bids_created-\d{8}-\d{4}\.zip$/);
    const jobDoc = (await dash().doc(`studies/demo/exportJobs/${job.id}`).get()).data()!;
    const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
    const zip = bytes.toString("latin1");
    for (const f of ["dataset_description.json", "participants.tsv", "linkage.tsv", "README.md", "export_manifest.json"]) expect(zip).toContain(f);
    expect(zip).toMatch(/sub-[A-Z]{2}[0-9]{3}[A-Z]{2}\/sessions\.tsv/);
    expect(zip).not.toContain("ps_mother_initials");
    expect(zip).not.toMatch(/\t(Alex|Sam|Jordan|Riley|Casey|Morgan|Taylor|Jamie|Robin|Charlie)\t/);
    // What could not be linked is reported, not dropped.
    expect(jobDoc["notes"]["notIncluded"]).toBeGreaterThan(0);
    expect(zip).toContain("Sittings not included");
    const created = (await auditRows("export.created")).find((r) => (r["target"] as { id: string } | null)?.id === job.id)!;
    expect(created["detail"]).toMatchObject({ format: "bids", identifiers: true });
  });

  it("de-identifies a BIDS dataset on request: no participant codes, study codes or sitting ids", async () => {
    const job = await run<{ id: string; status: string }>(createExport, researcher, { kind: "sessions", format: "bids", scope: "all", deidentified: true });
    const jobDoc = (await dash().doc(`studies/demo/exportJobs/${job.id}`).get()).data()!;
    const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
    const zip = bytes.toString("latin1");
    expect(zip).toContain("sub-P0001");
    expect(zip).not.toContain("linkage.tsv");
    for (const s of sittings) {
      expect(zip).not.toContain(s.doc.sessionId);
      if (s.doc.studyCode) expect(zip).not.toContain(s.doc.studyCode);
    }
  });

  it("puts participant codes and waves in CSV exports", async () => {
    const job = await run<{ id: string }>(createExport, researcher, { kind: "sessions", format: "csv", scope: "all" });
    const jobDoc = (await dash().doc(`studies/demo/exportJobs/${job.id}`).get()).data()!;
    const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
    const [header, ...lines] = bytes.toString("utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    expect(header!.startsWith("session_id,participant_code,wave,study_code,")).toBe(true);
    expect(lines.some((l) => /^[^,]+,[A-Z]{2}[0-9]{3}[A-Z]{2},2,/.test(l))).toBe(true);
  });

  it("a reviewer may export aggregate summaries in every format", async () => {
    for (const format of ["csv", "xlsx", "pdf"]) {
      const job = await run<{ status: string }>(createExport, reviewer, { kind: "completeness_summary", format, scope: "filtered", filters: DEFAULT_FILTERS });
      expect(job.status).toBe("ready");
    }
  });

  it("records every figure file leaving the dashboard, and refuses malformed requests", async () => {
    await run(logFigureExport, reviewer, { format: "pdf", panels: ["participation", "completion"], width: "double", colour: "colour" });
    const rows = await auditRows("figure.exported");
    expect(rows.some((r) => r["actorEmail"] === "reviewer@brainpop.example" && r["target"]?.id === "participation+completion" && r["detail"]?.format === "pdf")).toBe(true);
    await expect(run(logFigureExport, reviewer, { format: "exe", panels: ["status"], width: "double" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(run(logFigureExport, reviewer, { format: "png", panels: ["status"], width: "double", dpi: 99_999 })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(run(logFigureExport, stranger, { format: "svg", panels: ["status"], width: "single" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("a formatted single-session report, with the participant's code and the review notes", async () => {
    // A finished sitting, so the participant gave their secret code.
    const sessionId = sittings.find((s) => s.scenario === "complete" && s.doc.releaseHash === sittings[0]!.doc.releaseHash)?.doc.sessionId ?? sittings.find((s) => s.scenario === "complete")!.doc.sessionId;
    await run(addNote, researcher, { sessionId, text: "Checked with the site: code confirmed." });
    const job = await run<{ id: string; status: string; fileName: string }>(createExport, researcher, { kind: "session_report", format: "pdf", scope: "single", sessionIds: [sessionId] });
    expect(job.status).toBe("ready");
    expect(job.fileName).toMatch(/\.pdf$/);
    const read = async (id: string) => {
      const jobDoc = (await dash().doc(`studies/demo/exportJobs/${id}`).get()).data()!;
      const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
      return pdfText(bytes);
    };
    const text = await read(job.id);
    expect(text).toMatch(/Participant [A-Z]{2}[0-9]{3}[A-Z]{2}/);
    expect(text).toContain("Checked with the site: code confirmed.");
    expect(text).toContain("Researcher review");

    const plain = await run<{ id: string }>(createExport, researcher, { kind: "session_report", format: "pdf", scope: "single", sessionIds: [sessionId], deidentified: true, includeStudyCode: false });
    const plainText = await read(plain.id);
    expect(plainText).not.toMatch(/Participant ([A-Z]{2}[0-9]{3}[A-Z]{2}|P[0-9A-HJKMNP-TV-Z]{10}\b)/);
    expect(plainText).not.toContain("Study code".toUpperCase());
  });
});

describe("participants", () => {
  it("links sittings into participants, with codes only for roles that may see them, and audits the view", async () => {
    const shown = await run<ParticipantsResponse>(getParticipants, researcher, { fresh: true });
    expect(shown.codesShown).toBe(true);
    expect(shown.totals.participants).toBeGreaterThan(30);
    expect(shown.totals.linkedSittings + shown.totals.heldBack).toBe(sittings.length);
    expect(shown.participants.every((p) => /^[A-Z]{2}[0-9]{3}[A-Z]{2}/.test(p.code))).toBe(true);
    expect(shown.sharedCodes).toHaveLength(1);
    expect(JSON.stringify(shown)).not.toMatch(/ps_mother_initials|first_name/);

    const labelled = await run<ParticipantsResponse>(getParticipants, reviewer, {});
    expect(labelled.codesShown).toBe(false);
    const text = JSON.stringify(labelled);
    for (const p of shown.participants) expect(text).not.toContain(p.code);
    expect(labelled.participants[0]!.code).toBe("P0001");

    const rows = await auditRows("participants.viewed");
    expect(rows.some((r) => r["actorEmail"] === "reviewer@brainpop.example" && r["detail"]?.codesShown === false)).toBe(true);
    await expect(run(getParticipants, stranger, {})).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("scores", () => {
  it("summarises every instrument by school, as aggregates only", async () => {
    invalidateScoring();
    const view = await run<ScoresView>(getScores, reviewer, { filters: DEFAULT_FILTERS, groupBy: "school" });
    const swemwbs = view.results.find((r) => r.scheme === "swemwbs" && r.output === "metric")!;
    expect(swemwbs.overall!.n).toBeGreaterThan(20);
    expect(swemwbs.groups.map((g) => g.key)).toEqual(expect.arrayContaining(["BRD", "LDS", "NDC"]));
    // No participant or session identifiers anywhere in the response.
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/[A-Z]{2}[0-9]{3}[A-Z]{2}|\bP[0-9A-HJKMNP-TV-Z]{10}\b/); // a code, or a name-derived ID (D-52)
    for (const s of sittings.slice(0, 10)) expect(text).not.toContain(s.doc.sessionId);
    expect(view.checks["swemwbs"]!.every((c) => c.issues.every((i) => i.level !== "error"))).toBe(true);
  });

  it("compares a school's year group with the same year group elsewhere", async () => {
    const view = await run<ScoresView>(getScores, researcher, { filters: DEFAULT_FILTERS, groupBy: "schoolYear", focus: { school: "NDC", yearGroup: 8 } });
    expect(view.focus!.peersLabel).toMatch(/^Year \d+ at other schools$/);
    const r = view.results.find((x) => x.scheme === "sdq25_s" && x.output === "total_difficulties")!;
    expect(r.focus).toBeDefined();
    expect(r.focus!.peers!.n).toBeGreaterThan(0);
  });

  it("lets only administrators preview and save scheme changes, keeping every version and auditing it", async () => {
    const settings = await run<ScoringSettingsView>(getScoringSettings, researcher, {});
    expect(settings.canEdit).toBe(false);
    const kss = settings.schemes.find((s) => s.scheme.key === "kss")!;
    expect(kss.source).toBe("default");
    const draft = { ...kss.scheme, version: "1.1.0", outputs: [{ ...kss.scheme.outputs[0]!, thresholds: [{ ...kss.scheme.outputs[0]!.thresholds[0]!, bands: [{ label: "Alert", max: 5, level: 0 }, { label: "Sleepy", max: null, level: 2 }] }] }] };
    await expect(run(getScores, researcher, { draft })).rejects.toMatchObject({ code: "permission-denied" });
    const preview = await run<ScoresView>(getScores, admin, { draft, groupBy: "none" });
    expect(preview.schemes.map((s) => s.key)).toEqual(["kss"]);
    await expect(run(saveScoringScheme, researcher, { scheme: draft, reason: "stricter cut-off" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(saveScoringScheme, admin, { scheme: { ...draft, version: "1.0.0" }, reason: "same version" })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(run(saveScoringScheme, admin, { scheme: { ...draft, outputs: [] }, reason: "broken" })).rejects.toMatchObject({ code: "invalid-argument" });
    await run(saveScoringScheme, admin, { scheme: draft, reason: "Match the cut-off used in our protocol", markVerified: true, verifyNote: "Checked against protocol v3" });
    const after = await run<ScoringSettingsView>(getScoringSettings, admin, {});
    const saved = after.schemes.find((s) => s.scheme.key === "kss")!;
    expect(saved).toMatchObject({ source: "study", differsFromDefault: true });
    expect(saved.scheme.version).toBe("1.1.0");
    expect(saved.scheme.verified).toMatchObject({ by: "brainpopresearch@gmail.com", note: "Checked against protocol v3" });
    expect(saved.history.map((h) => h.version)).toEqual(["1.1.0"]);
    const rows = await auditRows("scoring.changed");
    expect(rows.some((r) => r["target"]?.id === "kss" && r["detail"]?.from === "1.0.0" && r["detail"]?.to === "1.1.0")).toBe(true);
    // Scores now follow the saved version.
    const view = await run<ScoresView>(getScores, reviewer, { groupBy: "none" });
    expect(view.schemes.find((s) => s.key === "kss")!.version).toBe("1.1.0");
  });

  it("writes a school report any member may export, naming no other school", async () => {
    const job = await run<{ id: string; status: string; fileName: string }>(createExport, reviewer, { kind: "school_report", format: "pdf", scope: "filtered", filters: DEFAULT_FILTERS, school: "NDC", observation: "latest" });
    expect(job.status).toBe("ready");
    expect(job.fileName).toMatch(/^myself_school-report-ndc_/);
    const jobDoc = (await dash().doc(`studies/demo/exportJobs/${job.id}`).get()).data()!;
    const [bytes] = await getStorage().bucket().file(jobDoc["storagePath"]).download();
    const text = pdfText(bytes);
    expect(text).toContain("School report");
    expect(text).toContain("How to read this report");
    expect(text).not.toMatch(/\bBRD\b|\bLDS\b/);
    await expect(run(createExport, reviewer, { kind: "school_report", format: "pdf", scope: "filtered", filters: DEFAULT_FILTERS })).rejects.toMatchObject({ code: "invalid-argument" });
    const rows = await auditRows("export.created");
    expect(rows.some((r) => r["detail"]?.kind === "school_report" && r["detail"]?.school === "NDC")).toBe(true);
  });

  it("lets administrators name schools and set year-group rules", async () => {
    await expect(run(saveGroupSettings, researcher, { settings: {}, reason: "names" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(saveGroupSettings, admin, { settings: { yearGroup: { rules: [{ pattern: "([", yearGroup: 8 }] } }, reason: "bad" })).rejects.toMatchObject({ code: "invalid-argument" });
    await run(saveGroupSettings, admin, { settings: { schools: { NDC: "Northdale College" }, minCell: 5 }, reason: "School names from the fieldwork plan" });
    const view = await run<ScoresView>(getScores, reviewer, { groupBy: "school" });
    expect(view.available.schools.find((s) => s.key === "NDC")!.label).toBe("Northdale College");
    expect(view.minCell).toBe(5);
    expect((await auditRows("groups.changed")).length).toBe(1);
  });
});

describe("codebook", () => {
  it("gives any member every question's readable name, codes and scoring, with the quality review; nobody else", async () => {
    const book = await run<CodebookResponse>(getCodebook, reviewer, {});
    expect(book.releases.length).toBeGreaterThan(1);
    expect(book.release.hash).toBe(book.releases.find((r) => r.active)!.hash);
    const q = book.rows.find((r) => r.key === "sdq25_s.q7")!;
    expect(q).toMatchObject({ name: "sdq_07_obeys", variable: "sdq25_q7" });
    expect(q.scoring[0]).toMatchObject({ output: "conduct", values: [2, 1, 0], transform: "reversed" });
    expect(book.rows.every((r) => r.named)).toBe(true);
    expect(book.counts.error).toBe(0);
    expect(book.findings.some((f) => f.id === "wording.sdq_form")).toBe(true);
    // An older version on request.
    const oldest = book.releases.at(-1)!;
    expect((await run<CodebookResponse>(getCodebook, reviewer, { release: oldest.hash })).release.version).toBe(oldest.version);
    await expect(run(getCodebook, noRole, {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(getCodebook, null, {})).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("administration", () => {
  it("only administrators see settings", async () => {
    await expect(run(getSettings, researcher, {})).rejects.toMatchObject({ code: "permission-denied" });
    const s = await run<{ people: { email: string }[] }>(getSettings, admin, {});
    expect(s.people.map((p) => p.email)).toContain("researcher@brainpop.example");
    // Survey devices are not listed as people.
    expect(s.people.some((p) => !p.email)).toBe(false);
  });

  it("grants roles only to allowlisted accounts and never lets an admin demote themselves", async () => {
    await expect(run(setDashboardRole, admin, { email: "stranger@gmail.com", role: "researcher" })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(run(setDashboardRole, admin, { email: "brainpopresearch@gmail.com", role: "analyst" })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(run(setDashboardRole, researcher, { email: "newcomer@brainpop.example", role: "owner" })).rejects.toMatchObject({ code: "permission-denied" });
    const r = await run<{ role: string }>(setDashboardRole, admin, { email: "newcomer@brainpop.example", role: "analyst" });
    expect(r.role).toBe("analyst");
    expect((await auditRows("role.changed")).some((x) => (x["detail"] as { email: string }).email === "newcomer@brainpop.example")).toBe(true);
  });

  it("an administrator cannot remove their own access", async () => {
    await expect(run(updateAccessPolicy, admin, { emails: [], domains: ["brainpop.example"] })).rejects.toMatchObject({ code: "failed-precondition" });
  });
});

describe("deploy-time operations", () => {
  it("rebuilds every summary on request and records the result", async () => {
    const ref = dash().doc("ops/test-rebuild");
    await ref.set({ kind: "rebuild_summaries", requestedBy: "test" });
    await handleOpsRequest(ref, (await ref.get()).data());
    const done = (await ref.get()).data()!;
    expect(done["status"]).toBe("done");
    expect(done["scanned"]).toBeGreaterThanOrEqual(sittings.length);
    expect((await auditRows("summaries.rebuilt")).some((r) => r["detail"]?.via === "ops request")).toBe(true);
  });

  it("refuses unknown requests", async () => {
    const ref = dash().doc("ops/test-unknown");
    await ref.set({ kind: "drop_everything" });
    await handleOpsRequest(ref, (await ref.get()).data());
    expect((await ref.get()).data()!["status"]).toBe("rejected");
  });
});

describe("summaries", () => {
  it("keep the first time the server received a sitting across later uploads", async () => {
    const s = sittings[5]!;
    const before = (await dash().doc(`studies/demo/sessionSummaries/${s.doc.sessionId}`).get()).data()!;
    await summariseSitting(s.doc.sessionId, { ...s.doc, receivedAt: new Date(Date.now() + 60_000).toISOString() } as never);
    const after = (await dash().doc(`studies/demo/sessionSummaries/${s.doc.sessionId}`).get()).data()!;
    expect(after["firstReceivedAt"]).toBe(before["firstReceivedAt"]);
    expect(after["receivedAt"]).not.toBe(before["receivedAt"]);
  });

  it("never contain identifying values or free text", async () => {
    const snap = await dash().collection("studies/demo/sessionSummaries").get();
    const text = JSON.stringify(snap.docs.map((d) => d.data()));
    expect(text).not.toMatch(/"(Alex|Sam|Jordan|Riley|Casey|Morgan)"/);
    expect(text).not.toContain("HYPERLINK");
  });
});

// Last, because it registers a new version: MySelf Studio's records, read from the survey's database.
describe("survey versions from MySelf Studio", () => {
  const SURVEY = "demo_survey";
  const at = (iso: string) => Timestamp.fromDate(new Date(iso));
  /** A version Studio published from 2.0.0, ending with MyStory: one the registry has never seen. */
  const studioVersion = (version: string) => {
    const { hash, ...body } = structuredClone(demoManifest("2.0.0")) as Record<string, any>;
    void hash;
    body["release"] = { ...body["release"], version, key: `demo_survey_r${version.replaceAll(".", "_")}`, publishedAt: "2026-09-20T09:00:00.000Z" };
    body["composition"]["sections"].push({ key: "mystory", title: "MyStory", components: [{ kind: "narrative", protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" }] });
    return { ...body, hash: contentHash(body) } as Record<string, any>;
  };
  const v3 = studioVersion("3.0.0");
  const v31 = studioVersion("3.1.0");
  const tampered = studioVersion("3.0.1");
  const v2 = demoManifest("2.0.0") as Record<string, any>;

  const copy = (m: Record<string, any>, manifest = JSON.stringify(m)) => ({
    surveyId: SURVEY, study: "demo", hash: m["hash"], version: m["release"]["version"], releaseKey: m["release"]["key"], engineVersion: m["release"]["engineVersion"], manifest, bytes: manifest.length, publishedAt: at(m["release"]["publishedAt"]),
  });
  const version = (m: Record<string, any>, more: Record<string, unknown>) => ({
    surveyId: SURVEY, version: m["release"]["version"], hash: m["hash"], releaseKey: m["release"]["key"], engineVersion: m["release"]["engineVersion"], releaseNote: "Published from the repository before MySelf Studio", changeSummary: null, bump: null,
    itemKeys: [], variables: [], source: "repository", draftRevision: null, basedOnVersion: null, authors: [], publishedAt: at(m["release"]["publishedAt"]), publishedBy: "repository", publishedByEmail: null, manifestPublishedAt: m["release"]["publishedAt"], ...more,
  });
  const auditRow = (iso: string, action: string, subject: string, detail: Record<string, unknown>) => ({ at: at(iso), actor: "uid-a", actorEmail: "a@brainpop.example", action, surveyId: SURVEY, subject, detail });

  beforeAll(async () => {
    const survey = getFirestore();
    const base = "studies/demo";
    const changed = structuredClone(tampered);
    changed["composition"]["title"] = "Changed after publishing";
    const writes: [string, Record<string, unknown>][] = [
      [`${base}/surveys/${SURVEY}`, { surveyId: SURVEY, study: "demo", title: "Demo survey", createdAt: at("2026-09-01T09:00:00.000Z"), createdBy: "uid-a", active: null, latestVersion: "3.1.0", versionCount: 4, draftEditors: [] }],
      [`${base}/surveys/${SURVEY}/versions/2.0.0`, version(v2, {})],
      [`${base}/surveys/${SURVEY}/versions/3.0.0`, version(v3, { source: "studio", releaseNote: "=Adds MyStory at the end", changeSummary: { bump: "major", entries: [{ kind: "mystory.added", bump: "major", breaking: false, message: "MyStory added (np.phone_wellbeing@0.1.1)" }], counts: {} }, bump: "major", basedOnVersion: "2.0.0", authors: ["a@brainpop.example"], publishedBy: "uid-a", publishedByEmail: "a@brainpop.example", publishedAt: at("2026-09-20T09:00:00.000Z") })],
      [`${base}/surveys/${SURVEY}/versions/3.0.1`, version(tampered, { source: "studio", publishedByEmail: "a@brainpop.example" })],
      [`${base}/surveys/${SURVEY}/versions/3.1.0`, version(v31, { source: "studio", publishedByEmail: "a@brainpop.example" })],
      [`${base}/publicReleases/${v2["hash"].slice(7)}`, copy(v2)],
      [`${base}/publicReleases/${v3["hash"].slice(7)}`, copy(v3)],
      [`${base}/publicReleases/${v31["hash"].slice(7)}`, copy(v31)],
      [`${base}/publicReleases/${tampered["hash"].slice(7)}`, copy(tampered, JSON.stringify(changed))],
      [`${base}/published/${SURVEY}`, { surveyId: SURVEY, study: "demo", hash: v2["hash"], version: "2.0.0", releaseKey: v2["release"]["key"], engineVersion: "0.1.0", generation: 3, publishedAt: at(v2["release"]["publishedAt"]) }],
      [`${base}/studioAudit/a1`, auditRow("2026-09-01T09:00:00.000Z", "survey.imported", SURVEY, { imported: ["2.0.0"], active: "2.0.0", createdSurvey: true, createdDraft: true })],
      [`${base}/studioAudit/a2`, auditRow("2026-09-20T09:00:00.000Z", "version.published", "3.0.0", { version: "3.0.0", hash: v3["hash"], releaseNote: "=Adds MyStory at the end", generation: 2 })],
      [`${base}/studioAudit/a3`, auditRow("2026-09-21T09:00:00.000Z", "draft.edited", "x", {})],
      [`${base}/studioAudit/a4`, auditRow("2026-09-22T09:00:00.000Z", "version.activated", "2.0.0", { version: "2.0.0", hash: v2["hash"], reason: "MyStory needs the newer app on every iPad first", generation: 3 })],
    ];
    for (const [path, data] of writes) await survey.doc(path).set(data);
    resetStudioCache();
  });

  it("reads sittings under a version Studio published, once its copy proves to be that version", async () => {
    const s = sittings[0]!;
    const doc = { ...s.doc, sessionId: "ses_studio_v3", releaseHash: v3["hash"], releaseKey: v3["release"]["key"] };
    const summary = await summariseSitting(doc.sessionId, doc as never);
    expect(summary.releaseKnown).toBe(true);
    expect(summary.releaseVersion).toBe("3.0.0");
    const registered = (await dash().doc(`studies/demo/releases/${v3["hash"]}`).get()).data()!;
    expect(registered["provenance"]).toMatchObject({ source: "studio", surveyId: SURVEY, version: "3.0.0" });
    expect((await auditRows("release.registered")).filter((r) => r["target"]?.id === v3["hash"])).toHaveLength(1);
    // A second sitting under it reads the registry; no second registration.
    await summariseSitting("ses_studio_v3b", { ...doc, sessionId: "ses_studio_v3b" } as never);
    expect((await auditRows("release.registered")).filter((r) => r["target"]?.id === v3["hash"])).toHaveLength(1);
  });

  it("refuses a copy that has changed since it was published, says so once, and reads nothing through it", async () => {
    const doc = { ...sittings[1]!.doc, sessionId: "ses_studio_tampered", releaseHash: tampered["hash"], releaseKey: tampered["release"]["key"] };
    const summary = await summariseSitting(doc.sessionId, doc as never);
    expect(summary.releaseKnown).toBe(false);
    expect(summary.counts.required).toBe(0);
    await summariseSitting(doc.sessionId, doc as never);
    expect((await dash().doc(`studies/demo/releases/${tampered["hash"]}`).get()).exists).toBe(false);
    const refusals = (await auditRows("release.refused")).filter((r) => r["target"]?.id === tampered["hash"]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!["outcome"]).toBe("failed");
    expect(refusals[0]!["detail"]["reason"]).toMatch(/does not hash to it/);
  });

  it("lists Studio's history: the live version, who published what and when, MyStory, sittings and live periods", async () => {
    resetStore();
    const r = await run<SurveyVersionsResponse>(listSurveyVersions, reviewer, {});
    expect(r.studioSetUp).toBe(true);
    expect(r.live).toEqual([expect.objectContaining({ surveyId: SURVEY, version: "2.0.0", generation: 3, since: "2026-09-22T09:00:00.000Z" })]);
    const byVersion = new Map(r.versions.map((v) => [v.version, v]));
    expect(r.versions.map((v) => v.version)).toEqual(["3.1.0", "3.0.1", "3.0.0", "2.0.0", "1.1.0", "1.0.0"]);
    expect(byVersion.get("3.0.0")).toMatchObject({
      source: "studio", inStudio: true, registered: true, sittings: 2, publishedBy: "a@brainpop.example", authors: ["a@brainpop.example"], basedOn: "2.0.0",
      changes: ["MyStory added (np.phone_wellbeing@0.1.1)"], myStory: { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" }, live: false,
      livePeriods: [{ from: "2026-09-20T09:00:00.000Z", to: "2026-09-22T09:00:00.000Z", how: "published", reason: null }],
    });
    expect(byVersion.get("2.0.0")).toMatchObject({ source: "repository", live: true, myStory: null });
    expect(byVersion.get("2.0.0")!.livePeriods.map((p) => p.how)).toEqual(["set_up", "made_live_again"]);
    expect(byVersion.get("3.0.1")).toMatchObject({ registered: false, sittings: 1 });
    expect(byVersion.get("3.0.1")!.problem).toMatch(/does not hash to it/);
    expect(byVersion.get("3.1.0")).toMatchObject({ registered: false, sittings: 0, problem: null });
    // Only in the registry: from the repository.
    expect(byVersion.get("1.0.0")).toMatchObject({ inStudio: false, source: "repository", surveyId: null });
  });

  it("serves a manifest from the registry or Studio's checked copy, never a changed one", async () => {
    const fromStudio = await run<{ manifestJson: string }>(getSurveyManifest, reviewer, { hash: v31["hash"] });
    expect(fromStudio.manifestJson).toBe(JSON.stringify(v31));
    const fromRegistry = await run<{ manifestJson: string }>(getSurveyManifest, reviewer, { hash: v2["hash"] });
    expect(JSON.parse(fromRegistry.manifestJson)["hash"]).toBe(v2["hash"]);
    await expect(run(getSurveyManifest, reviewer, { hash: tampered["hash"] })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(run(getSurveyManifest, reviewer, { hash: "../../config/access" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(run(getSurveyManifest, reviewer, { hash: `sha256:${"0".repeat(64)}` })).rejects.toMatchObject({ code: "not-found" });
  });

  it("exports the provenance as spreadsheet-safe CSV and JSON, and audits it", async () => {
    const out = await run<{ csv: string; json: string }>(exportSurveyProvenance, researcher, {});
    const [header, ...lines] = out.csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toContain("survey,version,release_key,hash,engine_version,status,source,in_studio,read_by_dashboard,authors,published_by,published_at");
    expect(lines).toHaveLength(6);
    const row = (v: string) => lines.find((l) => l.startsWith(`${SURVEY},${v},`));
    expect(row("3.0.0")).toContain(",'=Adds MyStory at the end,");
    expect(row("2.0.0")).toContain(",live,repository,");
    expect(JSON.parse(out.json)).toMatchObject({ study: "demo", studioSetUp: true });
    expect((await auditRows("survey.provenance_exported")).some((r) => r["actorEmail"] === researcher.email)).toBe(true);
  });

  it("is for dashboard members only", async () => {
    await expect(run(listSurveyVersions, stranger, {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(exportSurveyProvenance, device, {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run(getSurveyManifest, null, { hash: v2["hash"] })).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

async function download(jobId: string, who: Person | null): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const headers: Record<string, string> = {};
  let status = 200;
  const chunks: Buffer[] = [];
  const res = new PassThrough() as PassThrough & Record<string, unknown>;
  res.on("data", (c: Buffer) => chunks.push(c));
  let jsonBody: unknown = null;
  Object.assign(res, {
    set: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return res;
    },
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (b: unknown) => {
      jsonBody = b;
      res.end();
    },
    headersSent: false,
  });
  const reqObj = {
    method: "GET",
    query: { job: jobId },
    headers: { ...(who ? { authorization: `Bearer ${who.idToken}` } : {}), origin: "http://localhost:5173" },
    header: () => undefined,
    get: () => undefined,
  };
  const done = new Promise<void>((resolve) => res.on("finish", resolve));
  await (downloadExport as unknown as (q: unknown, r: unknown) => Promise<void>)(reqObj, res);
  if (!res.writableEnded) res.end();
  await done;
  void jsonBody;
  return { status, headers, body: Buffer.concat(chunks) };
}
