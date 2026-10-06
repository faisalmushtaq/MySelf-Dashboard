import { indexRelease, ManifestError, manifestFacts, parseManifest, type ManifestFacts, type ReleaseIndex } from "@myself-dashboard/core";
import { verifyManifestHash } from "@myself-dashboard/core/node";
import { hashHex, verifyRawManifestHash } from "@myself-dashboard/core/survey";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { audit, auditIn } from "./audit.js";
import { dash, research } from "./env.js";
import { dpaths, spaths } from "./paths.js";

/**
 * The release registry: every survey version a study has published, keyed by
 * its content hash, one registry per study. Metadata lives in
 * `studies/{study}/releases/{hash}` (readable by the study's dashboard users);
 * the manifest itself in `…/releaseManifests/{hash}` (backend only). A release
 * is only ever looked up in its sitting's own study (docs/12 §12.2): the
 * repository's bundled releases are registered for `ybm` alone.
 *
 * Manifests are immutable, so a parsed one is cached for the life of the
 * instance; the list of hashes is re-read at most once a minute.
 *
 * MySelf Studio publishes versions into the survey's own database (docs/11).
 * A sitting under a version the registry does not hold yet is read through
 * Studio's copy, `publicReleases/{hex}`, once that copy has proved to be the
 * version the sitting names — its content hashes to that hash — and it is
 * then registered like any other (`resolveRelease`).
 */

export interface ReleaseMeta {
  hash: string;
  key: string;
  version: string;
  study: string;
  title: string;
  publishedAt: string;
  questionCount: number;
  sectionCount: number;
  /** How the registry came by it, for a version registered from MySelf Studio. */
  provenance?: { source: "studio"; surveyId: string | null; version: string; from: string };
}

/** Caches are keyed by study and hash: a version registered in one study is nothing in another. */
const keyOf = (study: string, hash: string) => `${study} ${hash}`;
const indexes = new Map<string, ReleaseIndex>();
const facts = new Map<string, ManifestFacts>();
const listCache = new Map<string, { at: number; metas: ReleaseMeta[] }>();
const LIST_TTL_MS = 60_000;

export async function releaseList(study: string, fresh = false): Promise<ReleaseMeta[]> {
  const hit = listCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL_MS) return hit.metas;
  const snap = await dash().collection(dpaths.releases(study)).get();
  const metas = snap.docs.map((d) => d.data() as ReleaseMeta).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  listCache.set(study, { at: Date.now(), metas });
  return metas;
}

export async function releaseIndex(study: string, hash: string | null | undefined): Promise<ReleaseIndex | null> {
  if (!hash) return null;
  const key = keyOf(study, hash);
  const hit = indexes.get(key);
  if (hit) return hit;
  const snap = await dash().doc(dpaths.releaseManifest(study, hash)).get();
  if (!snap.exists) return null;
  const json = (snap.data() as { manifestJson?: string }).manifestJson;
  if (!json) return null;
  const raw = JSON.parse(json);
  facts.set(key, manifestFacts(raw));
  const index = indexRelease(raw, hash);
  indexes.set(key, index);
  return index;
}

/** What a registered version's manifest says about itself (engine, MyStory, survey). */
export async function registryFacts(study: string, hash: string): Promise<ManifestFacts | null> {
  if (!facts.has(keyOf(study, hash))) await releaseIndex(study, hash);
  return facts.get(keyOf(study, hash)) ?? null;
}

export async function allReleaseIndexes(study: string): Promise<ReleaseIndex[]> {
  const metas = await releaseList(study);
  const out: ReleaseIndex[] = [];
  for (const m of metas) {
    const idx = await releaseIndex(study, m.hash);
    if (idx) out.push(idx);
  }
  return out;
}

export class ReleaseRejected extends Error {}

/**
 * Validate a manifest and prepare the two documents that register it.
 * Refuses one whose content does not produce its stated hash: a sitting is tied
 * to its version BY that hash, so such a manifest is not that version.
 */
export function prepareRelease(raw: unknown, study: string): { meta: ReleaseMeta; manifestJson: string } {
  if (!raw || typeof raw !== "object") throw new ReleaseRejected("not a manifest");
  const check = verifyManifestHash(raw as Record<string, unknown>);
  if (!check.ok) {
    throw new ReleaseRejected(
      check.stated ? `hash mismatch: the manifest says ${check.stated} but its content hashes to ${check.computed}` : "the manifest has no hash — publish it through the release builder first",
    );
  }
  const m = parseManifest(raw);
  if (m.release.study !== study) throw new ReleaseRejected(`this manifest belongs to study '${m.release.study}', not '${study}'`);
  const idx = indexRelease(raw, check.computed);
  return {
    meta: {
      hash: check.computed,
      key: idx.key,
      version: idx.version,
      study: idx.study,
      title: idx.title,
      publishedAt: idx.publishedAt,
      questionCount: idx.questions.length,
      sectionCount: idx.sections.length,
    },
    manifestJson: JSON.stringify(raw),
  };
}

export async function registerRelease(raw: unknown, study: string, registeredBy: string): Promise<ReleaseMeta> {
  const { meta, manifestJson } = prepareRelease(raw, study);
  const db = dash();
  const batch = db.batch();
  batch.set(db.doc(dpaths.releaseManifest(study, meta.hash)), { manifestJson });
  batch.set(db.doc(dpaths.release(study, meta.hash)), { ...meta, registeredAt: FieldValue.serverTimestamp(), registeredBy });
  await batch.commit();
  listCache.delete(study);
  return meta;
}

// ── Versions MySelf Studio published ────────────────────────────────────────

const HASH = /^sha256:[0-9a-f]{64}$/;

/** Studio's copy of a release, once it has proved to be the version it is filed as. */
export interface StudioRelease {
  hash: string;
  surveyId: string | null;
  version: string;
  /** The manifest exactly as Studio stored it. */
  json: string;
  manifest: Record<string, unknown>;
}

/**
 * Check a `publicReleases/{hex}` document (survey docs/16 §5.2) before anything
 * reads through it, the way the participant app checks it before rendering
 * it: its manifest must hash, with the survey's own canonical code, to the
 * hash it is filed under, and the document must agree with its manifest about
 * which version and study it is. Anything else is refused with the reason —
 * never read as something it is not.
 */
export async function checkStudioRelease(hash: string, data: Record<string, unknown>, study: string): Promise<StudioRelease> {
  const json = data["manifest"];
  if (typeof json !== "string") throw new ReleaseRejected("Studio's copy holds no manifest");
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch {
    throw new ReleaseRejected("Studio's copy of the manifest is not valid JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new ReleaseRejected("Studio's copy is not a manifest");
  const m = manifest as Record<string, unknown>;
  if (m["hash"] !== hash) throw new ReleaseRejected(`Studio filed a manifest under ${hash} that says it is ${typeof m["hash"] === "string" ? m["hash"] : "unhashed"}`);
  if (!(await verifyRawManifestHash(m))) throw new ReleaseRejected(`the manifest Studio filed under ${hash} does not hash to it: it has changed since it was published`);
  const release = (m["release"] ?? {}) as Record<string, unknown>;
  for (const [field, theirs, ours] of [
    ["hash", data["hash"], hash],
    ["version", data["version"], release["version"]],
    ["releaseKey", data["releaseKey"], release["key"]],
    ["study", data["study"], release["study"]],
  ] as const) {
    if (theirs !== undefined && theirs !== ours) throw new ReleaseRejected(`Studio's record says its ${field} is ${String(theirs)}, but the manifest says ${String(ours)}`);
  }
  if (release["study"] !== study) throw new ReleaseRejected(`this manifest belongs to study '${String(release["study"])}', not '${study}'`);
  return { hash, surveyId: typeof data["surveyId"] === "string" ? data["surveyId"] : null, version: String(release["version"] ?? ""), json, manifest: m };
}

/** Studio's copy of a release by hash in `study`, checked; null when Studio has none. Throws ReleaseRejected. */
export async function studioRelease(hash: string, study: string): Promise<StudioRelease | null> {
  if (!HASH.test(hash)) return null;
  const snap = await research().doc(spaths.publicRelease(study, hashHex(hash))).get();
  if (!snap.exists) return null;
  return checkStudioRelease(hash, snap.data() as Record<string, unknown>, study);
}

/** Hashes Studio has no copy of, or refused, recently, by study and hash: not asked again on every sitting. */
const absent = new Map<string, number>();
const refused = new Map<string, { at: number; reason: string }>();
const ABSENT_TTL_MS = 60_000;
const REFUSED_TTL_MS = 10 * 60_000;
const adopting = new Map<string, Promise<ReleaseIndex | null>>();

/** Why the registry refused Studio's copy of a release, if it did lately. */
const refusalOf = (key: string): string | null => {
  const r = refused.get(key);
  return r && Date.now() - r.at < REFUSED_TTL_MS ? r.reason : null;
};

async function refuse(study: string, hash: string, reason: string): Promise<void> {
  const key = keyOf(study, hash);
  const reported = refusalOf(key) !== null;
  refused.set(key, { at: Date.now(), reason });
  if (reported) return;
  logger.error("a survey version from MySelf Studio failed its checks; sittings under it are not read", { study, hash, reason });
  await audit({ action: "release.refused", actorUid: null, actorEmail: null, actorRole: null, study, target: { type: "release", id: hash }, detail: { source: "studio", reason }, outcome: "failed" });
}

/**
 * Register a version from Studio's copy: once, in a transaction, so two
 * instances meeting the same new version together write it and its audit row
 * once between them.
 */
async function adopt(study: string, hash: string): Promise<ReleaseIndex | null> {
  const key = keyOf(study, hash);
  let found: StudioRelease | null;
  let prepared: ReturnType<typeof prepareRelease>;
  try {
    found = await studioRelease(hash, study);
    if (!found) {
      absent.set(key, Date.now());
      return null;
    }
    prepared = prepareRelease(found.manifest, study);
  } catch (error) {
    if (!(error instanceof ReleaseRejected || error instanceof ManifestError)) throw error;
    await refuse(study, hash, error.message);
    return null;
  }
  const { meta, manifestJson } = prepared;
  const { surveyId, version } = found;
  const provenance: NonNullable<ReleaseMeta["provenance"]> = { source: "studio", surveyId, version, from: spaths.publicRelease(study, hashHex(hash)) };
  const db = dash();
  const ref = db.doc(dpaths.release(study, meta.hash));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    tx.set(db.doc(dpaths.releaseManifest(study, meta.hash)), { manifestJson });
    tx.create(ref, { ...meta, provenance, registeredAt: FieldValue.serverTimestamp(), registeredBy: "studio" });
    auditIn(tx, { action: "release.registered", actorUid: null, actorEmail: null, actorRole: null, study, target: { type: "release", id: meta.hash }, detail: { version: meta.version, key: meta.key, source: "studio", surveyId } });
  });
  listCache.delete(study);
  logger.info("registered a survey version from MySelf Studio", { study, hash, version: meta.version });
  return releaseIndex(study, meta.hash);
}

/**
 * A sitting's version, in its own study: from that study's registry, or else
 * from MySelf Studio's copy in that study, checked and registered there. Null
 * when neither has it, or Studio's copy failed its checks (reported once, in
 * the log and the study's audit trail): the sitting is then an unregistered
 * version's, never read through another.
 */
export async function resolveRelease(study: string, hash: string | null | undefined): Promise<ReleaseIndex | null> {
  const found = await releaseIndex(study, hash);
  if (found || !hash) return found;
  const key = keyOf(study, hash);
  const missedAt = absent.get(key);
  if ((missedAt && Date.now() - missedAt < ABSENT_TTL_MS) || refusalOf(key)) return null;
  let pending = adopting.get(key);
  if (!pending) {
    pending = adopt(study, hash).finally(() => adopting.delete(key));
    adopting.set(key, pending);
  }
  return pending;
}

/** Test hook: forget what Studio did or did not have. */
export function resetStudioCache(): void {
  absent.clear();
  refused.clear();
  listCache.clear();
}
