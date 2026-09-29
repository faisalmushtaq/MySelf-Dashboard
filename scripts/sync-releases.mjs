#!/usr/bin/env node
/**
 * Register the survey's published release manifests in the dashboard's registry.
 *
 *   node scripts/sync-releases.mjs --from ../MySelf/releases --project myself-research [--study ybm] [--dry-run]
 *
 * For every *.manifest.json: parse it, RECOMPUTE its hash with the survey's own
 * canonicalisation and refuse it if the content does not match — a sitting is
 * tied to its version by that hash — then write releases/{hash} (metadata) and
 * releaseManifests/{hash} (content) in the `dashboard` database. Idempotent.
 * Unhashed manifests (e.g. the survey's preview manifest) are skipped.
 *
 * Credentials: application-default credentials (`gcloud auth application-default
 * login`) of someone with Datastore access on the project. No key file is needed
 * and none should be committed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { verifyManifestHash } from "@myself-dashboard/core/node";
import { indexRelease } from "@myself-dashboard/core";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const from = resolve(arg("from", "../MySelf/releases"));
const project = arg("project", process.env.GCLOUD_PROJECT);
const study = arg("study", "ybm");
const dryRun = args.includes("--dry-run");
if (!project) {
  console.error("Pass --project <firebase-project-id>.");
  process.exit(2);
}

const app = initializeApp({ projectId: project });
const db = getFirestore(app, "dashboard");
let registered = 0;
let skipped = 0;
for (const f of readdirSync(from).filter((x) => x.endsWith(".manifest.json")).sort()) {
  const raw = JSON.parse(readFileSync(join(from, f), "utf8"));
  const check = verifyManifestHash(raw);
  if (!check.stated) {
    console.log(`skip   ${f}: no hash (not a published release)`);
    skipped += 1;
    continue;
  }
  if (!check.ok) {
    console.error(`REFUSE ${f}: states ${check.stated} but its content hashes to ${check.computed}`);
    process.exitCode = 1;
    continue;
  }
  const idx = indexRelease(raw, check.computed);
  if (idx.study !== study) {
    console.log(`skip   ${f}: study '${idx.study}', not '${study}'`);
    skipped += 1;
    continue;
  }
  console.log(`${dryRun ? "would " : ""}register v${idx.version} ${idx.key} ${idx.hash.slice(0, 19)}… (${idx.questions.length} questions)`);
  if (!dryRun) {
    const batch = db.batch();
    batch.set(db.doc(`studies/${study}/releaseManifests/${idx.hash}`), { manifestJson: JSON.stringify(raw) });
    batch.set(db.doc(`studies/${study}/releases/${idx.hash}`), {
      hash: idx.hash,
      key: idx.key,
      version: idx.version,
      study: idx.study,
      title: idx.title,
      publishedAt: idx.publishedAt,
      questionCount: idx.questions.length,
      sectionCount: idx.sections.length,
      registeredAt: FieldValue.serverTimestamp(),
      registeredBy: "scripts/sync-releases.mjs",
    });
    await batch.commit();
  }
  registered += 1;
}
console.log(`${dryRun ? "checked" : "registered"} ${registered}, skipped ${skipped}`);
