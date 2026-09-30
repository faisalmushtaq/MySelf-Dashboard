import {
  applyEdits,
  diffWorkspaces,
  myStoryOf,
  nextVersion,
  provenanceCsv,
  unfreeze,
  type Activation,
  type Change,
  type Edit,
  type Level,
  type VersionRecord,
  type Workspace,
} from "@myself-dashboard/core";
import { rebuild } from "@myself-dashboard/core/node";
import { activeReleaseDoc, publishedPaths, publishedReleaseDoc } from "@myself-dashboard/core/survey";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit, auditIn } from "../audit.js";
import { requireActor, type Actor } from "../authz.js";
import { dash, research, STUDY } from "../env.js";
import { dpaths, spaths } from "../paths.js";
import { registerRelease, releaseList, type ReleaseMeta } from "../releases.js";
import { currentRows } from "../store.js";
import { callableOptions } from "./common.js";

/**
 * The survey editor's backend (docs/11; survey D-54).
 *
 * A draft is a base version plus a list of edits. Previewing and publishing
 * both rebuild it with the survey's own release builder, so nothing reaches a
 * device that the survey's publish gate would refuse. Publishing writes the
 * version to the dashboard's registry and to the survey's database, and makes
 * it the version devices use; making an earlier version active again is the
 * rollback. Both are owners' actions, and both are audited.
 */

const iso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : null);
const byVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

async function baseWorkspace(hash: unknown): Promise<Workspace> {
  if (typeof hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(hash)) throw new HttpsError("invalid-argument", "Choose the version the draft starts from.");
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
  if (!json) throw new HttpsError("not-found", "That version is not in the registry.");
  return unfreeze(JSON.parse(json));
}

function editsArg(raw: unknown): Edit[] {
  if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "A draft's edits are a list.");
  if (raw.length > 500) throw new HttpsError("invalid-argument", "A draft can hold at most 500 edits; publish and start a new one.");
  for (const e of raw) if (!e || typeof e !== "object" || typeof (e as { op?: unknown }).op !== "string") throw new HttpsError("invalid-argument", "An edit is not in the expected form.");
  return raw as Edit[];
}

const LEVELS: Level[] = ["patch", "minor", "major"];
const levelArg = (raw: unknown): Level | undefined => (LEVELS.includes(raw as Level) ? (raw as Level) : undefined);

async function highestVersion(): Promise<string> {
  const metas = await releaseList(true);
  return metas.map((m) => m.version).sort(byVersion).at(-1) ?? "0.0.0";
}

/** Apply the edits and rebuild: what a preview shows and a publish writes. */
async function assemble(data: Record<string, unknown>, publishedBy: string, publishedAt = new Date().toISOString()) {
  const base = await baseWorkspace(data["baseHash"]);
  const edits = editsArg(data["edits"]);
  const { workspace, failed } = applyEdits(base, edits);
  const changes: Change[] = diffWorkspaces(base, workspace);
  const next = nextVersion(await highestVersion(), changes, levelArg(data["level"]));
  const built = failed ? null : rebuild(workspace, { version: next.version, publishedAt, publishedBy, engineVersion: base.base.engineVersion });
  return {
    base,
    workspace,
    edits,
    failed: failed ?? null,
    changes,
    next,
    problems: built && "problems" in built ? built.problems : [],
    manifest: built && "manifest" in built ? built.manifest : null,
  };
}

// ── Drafts ──────────────────────────────────────────────────────────────────

export const listSurveyDrafts = onCall(callableOptions, async (request) => {
  await requireActor(request, "survey.edit");
  const snap = await dash().collection(dpaths.surveyDrafts()).orderBy("updatedAt", "desc").limit(100).get();
  return {
    drafts: snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, name: String(x["name"] ?? ""), baseHash: String(x["baseHash"] ?? ""), baseVersion: String(x["baseVersion"] ?? ""), edits: (x["edits"] as unknown[])?.length ?? 0, status: String(x["status"] ?? "open"), updatedAt: iso(x["updatedAt"]), updatedBy: (x["updatedBy"] as string) ?? null, publishedVersion: (x["publishedVersion"] as string) ?? null };
    }),
  };
});

export const getSurveyDraft = onCall(callableOptions, async (request) => {
  await requireActor(request, "survey.edit");
  const id = String((request.data as Record<string, unknown> | undefined)?.["id"] ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpsError("invalid-argument", "That is not a draft id.");
  const snap = await dash().doc(dpaths.surveyDraft(id)).get();
  if (!snap.exists) throw new HttpsError("not-found", "No draft with that id.");
  const x = snap.data()!;
  return { id, name: x["name"], baseHash: x["baseHash"], baseVersion: x["baseVersion"], edits: x["edits"] ?? [], status: x["status"] ?? "open", updatedAt: iso(x["updatedAt"]), updatedBy: x["updatedBy"] ?? null, rev: x["rev"] ?? 0 };
});

export const saveSurveyDraft = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "survey.edit");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const name = typeof data["name"] === "string" ? data["name"].trim().slice(0, 120) : "";
  if (!name) throw new HttpsError("invalid-argument", "Give the draft a name.");
  const edits = editsArg(data["edits"]);
  const base = await baseWorkspace(data["baseHash"]);
  // Stored only if every edit still applies: a draft that cannot be replayed is not a draft.
  const { failed } = applyEdits(base, edits);
  if (failed) throw new HttpsError("failed-precondition", `Edit ${failed.index + 1} no longer applies: ${failed.message}`);
  const db = dash();
  const ref = typeof data["id"] === "string" && data["id"] ? db.doc(dpaths.surveyDraft(data["id"])) : db.collection(dpaths.surveyDrafts()).doc();
  const expectedRev = typeof data["rev"] === "number" ? data["rev"] : null;
  const rev = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as { rev?: number; status?: string }) : null;
    if (current?.status === "published") throw new HttpsError("failed-precondition", "This draft has been published; start a new one from the version it became.");
    if (current && expectedRev !== null && (current.rev ?? 0) !== expectedRev) throw new HttpsError("aborted", "Someone else saved this draft a moment ago. Reload it and make your change again.");
    const next = (current?.rev ?? 0) + 1;
    tx.set(ref, { name, baseHash: data["baseHash"], baseVersion: base.base.version, edits, status: "open", rev: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email, ...(current ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.email }) });
    auditIn(tx, { action: "survey.draft_saved", ...actorFields(actor), target: { type: "survey_draft", id: ref.id }, detail: { edits: edits.length, baseVersion: base.base.version } });
    return next;
  });
  return { id: ref.id, rev };
});

export const deleteSurveyDraft = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "survey.edit");
  const id = String((request.data as Record<string, unknown> | undefined)?.["id"] ?? "");
  const ref = dash().doc(dpaths.surveyDraft(id));
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (snap.data()?.["status"] === "published") throw new HttpsError("failed-precondition", "A published draft is kept: it records how its version was made.");
  await ref.delete();
  await audit({ action: "survey.draft_deleted", ...actorFields(actor), target: { type: "survey_draft", id }, detail: null });
  return { ok: true };
});

// ── Preview and publish ─────────────────────────────────────────────────────

export const previewSurveyDraft = onCall({ ...callableOptions, memory: "1GiB" }, async (request) => {
  const actor = await requireActor(request, "survey.edit");
  const a = await assemble((request.data ?? {}) as Record<string, unknown>, actor.email ?? actor.uid);
  return {
    baseVersion: a.base.base.version,
    failed: a.failed,
    changes: a.changes,
    next: a.next,
    problems: a.problems,
    mystory: myStoryOf(a.workspace),
    // The draft as the participant app will run it, for the preview (survey D-54).
    manifest: a.manifest,
  };
});

export const publishSurveyVersion = onCall({ ...callableOptions, memory: "1GiB" }, async (request) => {
  const actor = await requireActor(request, "survey.publish");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const notes = typeof data["notes"] === "string" ? data["notes"].trim() : "";
  if (notes.length < 3 || notes.length > 2000) throw new HttpsError("invalid-argument", "Say why this version is being published (3–2000 characters): it is kept with the version.");
  const publisher = actor.email ?? actor.uid;
  const a = await assemble(data, publisher);
  if (a.failed) throw new HttpsError("failed-precondition", `Edit ${a.failed.index + 1} no longer applies: ${a.failed.message}`);
  if (a.changes.length === 0) throw new HttpsError("failed-precondition", "Nothing has changed from the version this draft started from.");
  if (!a.manifest) throw new HttpsError("failed-precondition", `The survey's publish checks refused this draft:\n- ${a.problems.slice(0, 12).join("\n- ")}`);

  const manifest = a.manifest as { hash: string; release: { version: string; key: string; publishedAt: string; engineVersion: string } };
  // One publish at a time, and never a version number twice.
  const db = dash();
  await db.runTransaction(async (tx) => {
    const lock = await tx.get(db.doc(dpaths.surveyPublishing()));
    const highest = (lock.data()?.["highest"] as string | undefined) ?? "0.0.0";
    if (byVersion(manifest.release.version, highest) <= 0) throw new HttpsError("aborted", `Version ${highest} was published a moment ago; preview again for the next number.`);
    tx.set(db.doc(dpaths.surveyPublishing()), { highest: manifest.release.version, at: FieldValue.serverTimestamp() });
  });

  const provenance = {
    source: "editor" as const,
    baseHash: a.base.base.hash,
    baseVersion: a.base.base.version,
    notes,
    bump: a.next.level,
    bumpReasons: a.next.reasons,
    changes: a.changes.map((c) => c.summary),
    mystory: (() => {
      const s = myStoryOf(a.workspace);
      return s ? `${s.key}@${s.version}` : null;
    })(),
    publishedBy: publisher,
  };
  const meta = await registerRelease(manifest, STUDY, actor.uid, provenance);
  await makeActive(actor, manifest as never, notes, "publish", notes);
  if (typeof data["draftId"] === "string" && data["draftId"]) {
    await db.doc(dpaths.surveyDraft(data["draftId"])).set({ status: "published", publishedVersion: meta.version, publishedHash: meta.hash, publishedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await audit({ action: "survey.published", ...actorFields(actor), target: { type: "release", id: meta.hash }, detail: { version: meta.version, baseVersion: a.base.base.version, bump: a.next.level, changes: a.changes.length } });
  return { hash: meta.hash, version: meta.version };
});

/**
 * Write a version to the survey's database and point devices at it, and record
 * the activation. Both documents are checked against the survey's own
 * description of them (its schema/published.ts, vendored) before they are
 * written, so a device never reads one it would refuse.
 */
async function makeActive(
  actor: Actor,
  manifest: { hash: string; release: { version: string; key: string; publishedAt: string; publishedBy?: string; engineVersion: string } },
  reason: string,
  how: "publish" | "rollback",
  notes?: string,
) {
  const survey = research();
  const r = manifest.release;
  const release = publishedReleaseDoc.parse({
    hash: manifest.hash,
    manifestJson: JSON.stringify(manifest),
    version: r.version,
    key: r.key,
    study: STUDY,
    publishedAt: r.publishedAt,
    ...(r.publishedBy ? { publishedBy: r.publishedBy } : {}),
    engineVersion: r.engineVersion,
    source: "editor",
    ...(notes ? { notes } : {}),
  });
  await survey.doc(publishedPaths.release(STUDY, manifest.hash)).set(release, { merge: true });
  const activatedAt = new Date().toISOString();
  const active = activeReleaseDoc.parse({ hash: manifest.hash, version: r.version, key: r.key, activatedAt, activatedBy: actor.email ?? actor.uid });
  await survey.doc(publishedPaths.activeRelease(STUDY)).set(active);
  await dash().collection(dpaths.releaseActivations()).add({ hash: manifest.hash, version: r.version, activatedAt, activatedBy: actor.email ?? actor.uid, reason, how });
}

export const activateSurveyVersion = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "survey.publish");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const reason = typeof data["reason"] === "string" ? data["reason"].trim() : "";
  if (reason.length < 3 || reason.length > 500) throw new HttpsError("invalid-argument", "Say why devices should use this version again (3–500 characters).");
  const hash = String(data["hash"] ?? "");
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
  if (!json) throw new HttpsError("not-found", "That version is not in the registry.");
  const manifest = JSON.parse(json) as { hash: string; release: { version: string; key: string; publishedAt: string; engineVersion: string } };
  await makeActive(actor, manifest, reason, "rollback");
  await audit({ action: "survey.activated", ...actorFields(actor), target: { type: "release", id: hash }, detail: { version: manifest.release.version } });
  return { hash, version: manifest.release.version };
});

// ── History and provenance ──────────────────────────────────────────────────

async function history(): Promise<{ versions: VersionRecord[]; activations: Activation[]; active: { hash: string; version: string; activatedAt: string | null } | null }> {
  const [metasSnap, actsSnap, activeSnap, { rows }] = await Promise.all([
    dash().collection(dpaths.releases()).get(),
    dash().collection(dpaths.releaseActivations()).orderBy("activatedAt", "asc").limit(1000).get(),
    research().doc(spaths.activeRelease()).get(),
    currentRows(new Date()),
  ]);
  const sittings = new Map<string, { n: number; first: string | null; last: string | null }>();
  for (const r of rows) {
    const h = r.summary.releaseHash;
    if (!h) continue;
    const e = sittings.get(h) ?? { n: 0, first: null, last: null };
    const at = r.summary.startedAt ?? null;
    e.n += 1;
    if (at && (!e.first || at < e.first)) e.first = at;
    if (at && (!e.last || at > e.last)) e.last = at;
    sittings.set(h, e);
  }
  const versions: VersionRecord[] = metasSnap.docs
    .map((d) => d.data() as ReleaseMeta & Record<string, unknown>)
    .map((m) => ({
      hash: m.hash,
      version: m.version,
      key: m.key,
      publishedAt: m.publishedAt,
      publishedBy: (m["publishedBy"] as string) ?? null,
      source: m["source"] === "editor" ? ("editor" as const) : ("repository" as const),
      baseVersion: (m["baseVersion"] as string) ?? null,
      notes: (m["notes"] as string) ?? null,
      bump: (m["bump"] as string) ?? null,
      changes: (m["changes"] as string[]) ?? [],
      mystory: (m["mystory"] as string) ?? null,
      sittings: sittings.get(m.hash)?.n ?? 0,
      firstSitting: sittings.get(m.hash)?.first ?? null,
      lastSitting: sittings.get(m.hash)?.last ?? null,
    }))
    .sort((a, b) => byVersion(a.version, b.version));
  const activations: Activation[] = actsSnap.docs.map((d) => {
    const x = d.data();
    return { hash: String(x["hash"]), version: String(x["version"]), activatedAt: String(x["activatedAt"]), activatedBy: (x["activatedBy"] as string) ?? null, reason: (x["reason"] as string) ?? null };
  });
  const a = activeSnap.data();
  return { versions, activations, active: a ? { hash: String(a["hash"]), version: String(a["version"]), activatedAt: (a["activatedAt"] as string) ?? null } : null };
}

export const listSurveyVersions = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "view.dashboard");
  const h = await history();
  return { ...h, canPublish: actor.role === "owner" };
});

export const exportSurveyProvenance = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "view.dashboard");
  const h = await history();
  await audit({ action: "survey.provenance_exported", ...actorFields(actor), target: { type: "study", id: STUDY }, detail: { versions: h.versions.length } });
  return { csv: provenanceCsv(h.versions, h.activations), json: JSON.stringify({ study: STUDY, exportedAt: new Date().toISOString(), ...h }, null, 2) };
});

/** A version's manifest, to download or to open in the preview. */
export const getSurveyManifest = onCall({ ...callableOptions, memory: "512MiB" }, async (request) => {
  await requireActor(request, "view.dashboard");
  const hash = String((request.data as Record<string, unknown> | undefined)?.["hash"] ?? "");
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
  if (!json) throw new HttpsError("not-found", "That version is not in the registry.");
  return { manifestJson: json };
});
