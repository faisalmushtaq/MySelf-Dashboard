#!/usr/bin/env node
/**
 * Prepare the local Emulator Suite with SYNTHETIC data (never real participants):
 *
 *   1. load firestore/dashboard.rules into the emulator for the `dashboard` database
 *      (and a deny-all ruleset for `(default)`, as in production for these clients);
 *   2. seed the access policy and study policy;
 *   3. register the three synthetic survey versions;
 *   4. create Google-provider accounts for each role (and one stranger);
 *   5. write synthetic sittings into the survey database — the dashboard's
 *      `onSessionWritten` trigger (running in the Functions emulator) summarises
 *      them, exactly as it would in production — and wait for it to finish;
 *   6. a second study space, "pilot" (docs/12): registered as the Studio would,
 *      with two Studio-published surveys and a few sittings under each, which
 *      the researcher may see and the reviewer may not.
 *
 * Run by `pnpm test:e2e` inside `firebase emulators:exec`, or by hand after
 * `pnpm dev:emulators`.
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { contentHash, demoManifest, DEMO_VERSIONS, generateDemoSittings, verifyManifestHash } from "@myself-dashboard/core/node";
import { indexRelease } from "@myself-dashboard/core";

const PROJECT = "demo-myself-dashboard";
const STUDY = "demo";
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8181";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.GCLOUD_PROJECT = PROJECT;

export const PEOPLE = {
  admin: { email: "brainpopresearch@gmail.com", role: "owner" },
  researcher: { email: "researcher@brainpop.example", role: "researcher" },
  reviewer: { email: "reviewer@brainpop.example", role: "analyst" },
  stranger: { email: "stranger@gmail.com", role: "owner" },
};

const app = initializeApp({ projectId: PROJECT });
const research = getFirestore(app);
const dash = getFirestore(app, "dashboard");

async function putRules(database, content) {
  const res = await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/${database}:securityRules`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: `${database}.rules`, content }] } }),
  });
  if (!res.ok) throw new Error(`rules for ${database}: ${res.status} ${await res.text()}`);
}

async function googleUser(email) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestUri: "http://localhost",
      returnSecureToken: true,
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name: email.split("@")[0] }))}&providerId=google.com`,
    }),
  });
  const body = await res.json();
  if (!body.localId) throw new Error(`could not create ${email}: ${JSON.stringify(body)}`);
  return body.localId;
}

const t0 = Date.now();
await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
for (const db of ["(default)", "dashboard"]) await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/${db}/documents`, { method: "DELETE" });

await putRules("dashboard", readFileSync(new URL("../firestore/dashboard.rules", import.meta.url), "utf8"));
await putRules("(default)", "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if false; } } }\n");

// defaultStudy: the security rules learn the default study from here (docs/12 §12.4).
await dash.doc("config/access").set({ emails: [PEOPLE.admin.email], domains: ["brainpop.example"], defaultStudy: STUDY });
await dash.doc("config/policy").set({ abandonAfterHours: 24, testCodePatterns: ["^TST", "^ZZZ"], requiredLevels: ["hard", "soft"], reviewerCanViewFreeText: false, exportRetentionHours: 24, timeZone: "Europe/London", tooFastWarningCount: 10, activeReleaseHash: null });

for (const v of DEMO_VERSIONS) {
  const m = demoManifest(v);
  if (!verifyManifestHash(m).ok) throw new Error(`synthetic manifest ${v} does not verify`);
  const idx = indexRelease(m);
  await dash.doc(`studies/${STUDY}/releaseManifests/${idx.hash}`).set({ manifestJson: JSON.stringify(m) });
  await dash.doc(`studies/${STUDY}/releases/${idx.hash}`).set({
    hash: idx.hash, key: idx.key, version: idx.version, study: idx.study, title: idx.title, publishedAt: idx.publishedAt,
    questionCount: idx.questions.length, sectionCount: idx.sections.length, registeredAt: new Date(), registeredBy: "emulator-setup",
  });
}

const uids = {};
for (const [who, p] of Object.entries(PEOPLE)) {
  const uid = await googleUser(p.email);
  uids[who] = uid;
  await getAuth(app).setCustomUserClaims(uid, { role: p.role });
  console.log(`  ${who.padEnd(10)} ${p.email} (${p.role})`);
}

const sittings = generateDemoSittings({ now: new Date(), count: Number(process.env.SEED_COUNT ?? 64), study: STUDY });
for (let i = 0; i < sittings.length; i += 100) {
  const batch = research.batch();
  for (const s of sittings.slice(i, i + 100)) batch.set(research.doc(`studies/${STUDY}/sessions/${s.doc.sessionId}`), s.doc);
  await batch.commit();
}

// Wait for the trigger to summarise every sitting.
const deadline = Date.now() + 120_000;
let n = 0;
while (Date.now() < deadline) {
  n = (await dash.collection(`studies/${STUDY}/sessionSummaries`).count().get()).data().count;
  if (n >= sittings.length) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (n < sittings.length) {
  console.error(`only ${n} of ${sittings.length} sittings were summarised — is the Functions emulator running?`);
  process.exit(1);
}
// A few sittings already flagged by a researcher, with a note each — in the
// same shape updateReview/addNote write, with their audit rows.
const toFlag = [
  ["speeder", "speeding", "Most answers under a second."],
  ["invalid_answer", "technical", "Sleep quality recorded an option code the survey does not have."],
  ["clock_ahead", "clock", "Device clock looks three hours fast."],
];
const at = new Date().toISOString();
for (const [scenario, reason, note] of toFlag) {
  const s = sittings.find((x) => x.scenario === scenario);
  if (!s) continue;
  const id = s.doc.sessionId;
  await dash.doc(`studies/${STUDY}/reviews/${id}`).set({
    sessionId: id,
    status: "needs_review",
    flags: [{ id: `seed-${reason}`, reason, note, open: true, createdBy: uids.researcher, createdByEmail: PEOPLE.researcher.email, createdAt: at, resolvedBy: null, resolvedAt: null }],
    qualityConcerns: reason === "speeding" ? ["low_effort"] : [],
    markedTest: false,
    markedInvalid: false,
    lastReviewedAt: null,
    lastReviewedBy: null,
    updatedAt: at,
    updatedBy: uids.researcher,
    noteCount: 1,
    rev: 2,
    _ts: FieldValue.serverTimestamp(),
  });
  await dash.collection(`studies/${STUDY}/reviews/${id}/notes`).add({ text: `Seeded note: ${note}`, authorUid: uids.researcher, authorEmail: PEOPLE.researcher.email, createdAt: FieldValue.serverTimestamp() });
  for (const action of ["review.updated", "note.added"]) {
    await dash.collection(`studies/${STUDY}/auditLog`).add({
      action,
      actorUid: uids.researcher,
      actorEmail: PEOPLE.researcher.email,
      actorRole: "researcher",
      target: { type: "session", id },
      detail: { seeded: true },
      outcome: "success",
      at: FieldValue.serverTimestamp(),
    });
  }
}

// ── A second study space (docs/12) ──────────────────────────────────────────
// As the Studio leaves one: its registry document, and two surveys published in it,
// each a version of the synthetic questions under the pilot study's own ids.
const PILOT = "pilot";
const day = (iso) => new Date(iso);
const pilotVersion = (surveyId, title) => {
  const { hash, ...body } = structuredClone(demoManifest("2.0.0"));
  void hash;
  body.release = { ...body.release, study: PILOT, assessment: surveyId, key: `${surveyId}_r1_0_0`, version: "1.0.0", publishedAt: "2026-09-20T09:00:00.000Z" };
  body.composition = { ...body.composition, key: surveyId, study: PILOT, title };
  return { ...body, hash: contentHash(body) };
};
const pilotSurveys = [pilotVersion("pilot_main", "Pilot: main questionnaire"), pilotVersion("pilot_extra", "Pilot: extra questions")];
await research.doc(`studies/${PILOT}`).set({ study: PILOT, title: "Pilot of the new questions", status: "open", createdAt: day("2026-09-18T09:00:00.000Z"), createdBy: uids.admin, updatedAt: day("2026-09-18T09:00:00.000Z"), updatedBy: uids.admin, closedAt: null });
for (const m of pilotSurveys) {
  const surveyId = m.release.assessment;
  const manifest = JSON.stringify(m);
  await research.doc(`studies/${PILOT}/surveys/${surveyId}`).set({ surveyId, study: PILOT, title: m.composition.title, createdAt: day("2026-09-18T09:00:00.000Z"), createdBy: uids.admin, active: null, latestVersion: "1.0.0", versionCount: 1, draftEditors: [] });
  await research.doc(`studies/${PILOT}/surveys/${surveyId}/versions/1.0.0`).set({
    surveyId, version: "1.0.0", hash: m.hash, releaseKey: m.release.key, engineVersion: m.release.engineVersion, releaseNote: "The pilot's first version", changeSummary: null, bump: null, itemKeys: [], variables: [],
    source: "studio", draftRevision: 2, basedOnVersion: null, authors: [PEOPLE.admin.email], publishedAt: day(m.release.publishedAt), publishedBy: uids.admin, publishedByEmail: PEOPLE.admin.email, manifestPublishedAt: m.release.publishedAt,
  });
  await research.doc(`studies/${PILOT}/publicReleases/${m.hash.slice("sha256:".length)}`).set({ surveyId, study: PILOT, hash: m.hash, version: "1.0.0", releaseKey: m.release.key, engineVersion: m.release.engineVersion, manifest, bytes: manifest.length, publishedAt: day(m.release.publishedAt) });
  await research.doc(`studies/${PILOT}/published/${surveyId}`).set({ surveyId, study: PILOT, hash: m.hash, version: "1.0.0", releaseKey: m.release.key, engineVersion: m.release.engineVersion, generation: 1, publishedAt: day(m.release.publishedAt) });
}
// Who else may see it: the researcher, by address. The reviewer may not.
await dash.doc(`studies/${PILOT}/config/access`).set({ emails: [PEOPLE.researcher.email], domains: [], updatedAt: new Date(), updatedBy: uids.admin, updatedByEmail: PEOPLE.admin.email });
const v2 = demoManifest("2.0.0").hash;
const ordinary = sittings.filter((s) => s.doc.releaseHash === v2 && !s.doc.quarantined && ["complete", "complete_no_phone", "incomplete_skips"].includes(s.scenario));
// e2e/studies.spec.ts counts these.
const PILOT_SITTINGS = { pilot_main: 6, pilot_extra: 4 };
if (ordinary.length < 10) throw new Error(`only ${ordinary.length} ordinary sittings under 2.0.0 to copy into the pilot study`);
let taken = 0;
const pilotDocs = [];
for (const m of pilotSurveys) {
  for (const s of ordinary.slice(taken, taken + PILOT_SITTINGS[m.release.assessment])) {
    pilotDocs.push({ ...s.doc, sessionId: `${s.doc.sessionId}P`, study: PILOT, releaseHash: m.hash, releaseKey: m.release.key });
  }
  taken += PILOT_SITTINGS[m.release.assessment];
}
const pilotBatch = research.batch();
for (const d of pilotDocs) pilotBatch.set(research.doc(`studies/${PILOT}/sessions/${d.sessionId}`), d);
await pilotBatch.commit();
const pilotDeadline = Date.now() + 60_000;
let p = 0;
while (Date.now() < pilotDeadline) {
  p = (await dash.collection(`studies/${PILOT}/sessionSummaries`).count().get()).data().count;
  if (p >= pilotDocs.length) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (p < pilotDocs.length) {
  console.error(`only ${p} of ${pilotDocs.length} pilot sittings were summarised — does the trigger summarise every registered study?`);
  process.exit(1);
}

console.log(`seeded ${sittings.length} synthetic sittings across ${DEMO_VERSIONS.length} versions, and ${pilotDocs.length} in a second study, summarised by the trigger, in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
