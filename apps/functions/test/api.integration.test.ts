import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { DEFAULT_FILTERS, type QuerySessionsResponse, type SessionDetailResponse } from "@myself-dashboard/core";
import { anonymousDevice, demoManifests, person, req, resetEmulators, seedSittings, type Person } from "./support.js";

import { dash } from "../src/env.js";
import { registerRelease } from "../src/releases.js";
import { summariseSitting } from "../src/summaries.js";
import { invalidateSettings } from "../src/settings.js";
import { resetStore } from "../src/store.js";
import { whoAmI } from "../src/api/access.js";
import { getSessionDetail, querySessions } from "../src/api/sessions.js";
import { getAnalytics, getQuestionAnalytics, getQuestionHistory } from "../src/api/analytics.js";
import { addNote, updateReview } from "../src/api/review.js";
import { logFigureExport, setDashboardRole, updateAccessPolicy, getSettings } from "../src/api/admin.js";
import { createExport, downloadExport, expireExports, previewExport } from "../src/api/exports.js";

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
    expect(ok.fileName).toMatch(/^myself_sessions-filtered_all-time_deidentified_created-\d{8}-\d{4}\.csv$/);
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

  it("a formatted single-session report", async () => {
    const job = await run<{ status: string; fileName: string }>(createExport, researcher, { kind: "session_report", format: "pdf", scope: "single", sessionIds: [sittings[3]!.doc.sessionId] });
    expect(job.status).toBe("ready");
    expect(job.fileName).toMatch(/\.pdf$/);
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
