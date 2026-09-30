#!/usr/bin/env node
/**
 * Seed a running Emulator Suite with the made-up YBM study (./ybm-study.mjs):
 * the real r8.0.0 and r9.0.0 releases, invented children, a few reviews and
 * notes. The dashboard's own trigger summarises the sittings, as in production.
 * Nothing here is participant data.
 *
 * Emulator hosts come from FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST
 * (set by `firebase emulators:exec`); the study from MYSELF_STUDY (default ybm).
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { indexRelease } from "@myself-dashboard/core";
import { verifyManifestHash } from "@myself-dashboard/core/node";
import { generateYbmStudy, SCHOOLS } from "./ybm-study.mjs";

const PROJECT = process.env.GCLOUD_PROJECT ?? "demo-myself-dashboard";
const STUDY = process.env.MYSELF_STUDY ?? "ybm";
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FS || !AUTH) throw new Error("Run inside `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are unset).");

export const OWNER = { email: "demo.researcher@brainpop.example", role: "owner" };
const COLLEAGUE = { email: "colleague@brainpop.example", role: "researcher" };

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
await putRules("dashboard", readFileSync(new URL("../../firestore/dashboard.rules", import.meta.url), "utf8"));
await putRules("(default)", "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{d=**} { allow read, write: if false; } } }\n");

const { sittings, releases } = generateYbmStudy({ study: STUDY });
const r9 = indexRelease(releases.at(-1));
await dash.doc("config/access").set({ emails: [OWNER.email], domains: ["brainpop.example"] });
await dash.doc("config/policy").set({ abandonAfterHours: 24, testCodePatterns: ["^TST", "^ZZZ"], requiredLevels: ["hard", "soft"], reviewerCanViewFreeText: false, exportRetentionHours: 24, timeZone: "Europe/London", tooFastWarningCount: 10, activeReleaseHash: r9.hash });
await dash.doc("config/groups").set({ schools: SCHOOLS, minCell: 5, updatedAt: FieldValue.serverTimestamp(), updatedBy: "demo-seed" }, { merge: true });
for (const m of releases) {
  if (!verifyManifestHash(m).ok) throw new Error(`release ${m.version} does not verify`);
  const idx = indexRelease(m);
  await dash.doc(`studies/${STUDY}/releaseManifests/${idx.hash}`).set({ manifestJson: JSON.stringify(m) });
  await dash.doc(`studies/${STUDY}/releases/${idx.hash}`).set({
    hash: idx.hash, key: idx.key, version: idx.version, study: idx.study, title: idx.title, publishedAt: idx.publishedAt,
    questionCount: idx.questions.length, sectionCount: idx.sections.length, registeredAt: new Date(), registeredBy: "demo-seed",
  });
}

const owner = await googleUser(OWNER.email);
await getAuth(app).setCustomUserClaims(owner, { role: OWNER.role });
const colleague = await googleUser(COLLEAGUE.email);
await getAuth(app).setCustomUserClaims(colleague, { role: COLLEAGUE.role });

for (let i = 0; i < sittings.length; i += 10) {
  const batch = research.batch();
  for (const s of sittings.slice(i, i + 10)) batch.set(research.doc(`studies/${STUDY}/sessions/${s.sessionId}`), s);
  await batch.commit();
  process.stdout.write(".");
}

const deadline = Date.now() + 180_000;
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

// Two sittings a colleague has already looked at, with a note each, in the shape updateReview/addNote write.
const flagged = [
  [sittings.find((s) => s.events.some((e) => e.type === "response.too_fast") && !s.studyCode.startsWith("SCN")), "speeding", "Most answers under a second."],
  [sittings.find((s) => s.studyCode === "SCN0001"), "other", "Typed a spreadsheet formula as free text; the export defuses it."],
];
const at = new Date().toISOString();
for (const [s, reason, note] of flagged) {
  if (!s) continue;
  const id = s.sessionId;
  await dash.doc(`studies/${STUDY}/reviews/${id}`).set({
    sessionId: id, status: "needs_review",
    flags: [{ id: `seed-${reason}`, reason, note, open: true, createdBy: colleague, createdByEmail: COLLEAGUE.email, createdAt: at, resolvedBy: null, resolvedAt: null }],
    qualityConcerns: reason === "speeding" ? ["low_effort"] : [], markedTest: false, markedInvalid: false, lastReviewedAt: null, lastReviewedBy: null,
    updatedAt: at, updatedBy: colleague, noteCount: 1, rev: 2, _ts: FieldValue.serverTimestamp(),
  });
  await dash.collection(`studies/${STUDY}/reviews/${id}/notes`).add({ text: note, authorUid: colleague, authorEmail: COLLEAGUE.email, createdAt: FieldValue.serverTimestamp() });
  for (const action of ["review.updated", "note.added"]) {
    await dash.collection(`studies/${STUDY}/auditLog`).add({
      action, actorUid: colleague, actorEmail: COLLEAGUE.email, actorRole: COLLEAGUE.role, target: { type: "session", id }, detail: { seeded: true }, outcome: "success", at: FieldValue.serverTimestamp(),
    });
  }
}

console.log(`seeded ${sittings.length} made-up sittings (${releases.map((r) => indexRelease(r).version).join(", ")}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
