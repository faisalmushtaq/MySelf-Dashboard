import { indexRelease, ManifestError, manifestFacts, parseManifest, type ManifestFacts, type ReleaseIndex } from "@myself-dashboard/core";
import { verifyManifestHash } from "@myself-dashboard/core/node";
import { hashHex, verifyRawManifestHash } from "@myself-dashboard/core/survey";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { audit, auditIn } from "./audit.js";
import { dash, research, STUDY } from "./env.js";
import { dpaths, spaths } from "./paths.js";

/**
 * The release registry: every survey version the study has published, keyed by
 * its content hash. Metadata lives in `releases/{hash}` (readable by dashboard
 * users); the manifest itself in `releaseManifests/{hash}` (backend only).
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

const indexes = new Map<string, ReleaseIndex>();
const facts = new Map<string, ManifestFacts>();
let listCache: { at: number; metas: ReleaseMeta[] } | null = null;
const LIST_TTL_MS = 60_000;

export async function releaseList(fresh = false): Promise<ReleaseMeta[]> {
  if (!fresh && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.metas;
  const snap = await dash().collection(dpaths.releases()).get();
  const metas = snap.docs.map((d) => d.data() as ReleaseMeta).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  listCache = { at: Date.now(), metas };
  return metas;
}

export async function releaseIndex(hash: string | null | undefined): Promise<ReleaseIndex | null> {
  if (!hash) return null;
  const hit = indexes.get(hash);
  if (hit) return hit;
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  if (!snap.exists) return null;
  const json = (snap.data() as { manifestJson?: string }).manifestJson;
  if (!json) return null;
  const raw = JSON.parse(json);
  facts.set(hash, manifestFacts(raw));
  const index = indexRelease(raw, hash);
  indexes.set(hash, index);
  return index;
}

/** What a registered version's manifest says about itself (engine, MyStory). */
export async function registryFacts(hash: string): Promise<ManifestFacts | null> {
  if (!facts.has(hash)) await releaseIndex(hash);
  return facts.get(hash) ?? null;
}

export async function allReleaseIndexes(): Promise<ReleaseIndex[]> {
  const metas = await releaseList();
  const out: ReleaseIndex[] = [];
  for (const m of metas) {
    const idx = await releaseIndex(m.hash);
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
  batch.set(db.doc(dpaths.releaseManifest(meta.hash, study)), { manifestJson });
  batch.set(db.doc(dpaths.release(meta.hash, study)), { ...meta, registeredAt: FieldValue.serverTimestamp(), registeredBy });
  await batch.commit();
  listCache = null;
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

/** Studio's copy of a release by hash, checked; null when Studio has none. Throws ReleaseRejected. */
export async function studioRelease(hash: string, study = STUDY): Promise<StudioRelease | null> {
  if (!HASH.test(hash)) return null;
  const snap = await research().doc(spaths.publicRelease(hashHex(hash), study)).get();
  if (!snap.exists) return null;
  return checkStudioRelease(hash, snap.data() as Record<string, unknown>, study);
}

/** Hashes Studio has no copy of, or refused, recently: not asked again on every sitting. */
const absent = new Map<string, number>();
const refused = new Map<string, { at: number; reason: string }>();
const ABSENT_TTL_MS = 60_000;
const REFUSED_TTL_MS = 10 * 60_000;
const adopting = new Map<string, Promise<ReleaseIndex | null>>();

/** Why the registry refused Studio's copy of a release, if it did lately. */
const refusalOf = (hash: string): string | null => {
  const r = refused.get(hash);
  return r && Date.now() - r.at < REFUSED_TTL_MS ? r.reason : null;
};

async function refuse(hash: string, reason: string): Promise<void> {
  const reported = refusalOf(hash) !== null;
  refused.set(hash, { at: Date.now(), reason });
  if (reported) return;
  logger.error("a survey version from MySelf Studio failed its checks; sittings under it are not read", { hash, reason });
  await audit({ action: "release.refused", actorUid: null, actorEmail: null, actorRole: null, target: { type: "release", id: hash }, detail: { source: "studio", reason }, outcome: "failed" });
}

/**
 * Register a version from Studio's copy: once, in a transaction, so two
 * instances meeting the same new version together write it and its audit row
 * once between them.
 */
async function adopt(hash: string): Promise<ReleaseIndex | null> {
  let found: StudioRelease | null;
  let prepared: ReturnType<typeof prepareRelease>;
  try {
    found = await studioRelease(hash);
    if (!found) {
      absent.set(hash, Date.now());
      return null;
    }
    prepared = prepareRelease(found.manifest, STUDY);
  } catch (error) {
    if (!(error instanceof ReleaseRejected || error instanceof ManifestError)) throw error;
    await refuse(hash, error.message);
    return null;
  }
  const { meta, manifestJson } = prepared;
  const { surveyId, version } = found;
  const provenance: NonNullable<ReleaseMeta["provenance"]> = { source: "studio", surveyId, version, from: spaths.publicRelease(hashHex(hash)) };
  const db = dash();
  const ref = db.doc(dpaths.release(meta.hash));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    tx.set(db.doc(dpaths.releaseManifest(meta.hash)), { manifestJson });
    tx.create(ref, { ...meta, provenance, registeredAt: FieldValue.serverTimestamp(), registeredBy: "studio" });
    auditIn(tx, { action: "release.registered", actorUid: null, actorEmail: null, actorRole: null, target: { type: "release", id: meta.hash }, detail: { version: meta.version, key: meta.key, source: "studio", surveyId } });
  });
  listCache = null;
  logger.info("registered a survey version from MySelf Studio", { hash, version: meta.version });
  return releaseIndex(meta.hash);
}

/**
 * A sitting's version: from the registry, or else from MySelf Studio's copy,
 * checked and registered. Null when neither has it, or Studio's copy failed
 * its checks (reported once, in the log and the audit trail): the sitting is
 * then an unregistered version's, never read through another.
 */
export async function resolveRelease(hash: string | null | undefined): Promise<ReleaseIndex | null> {
  const known = await releaseIndex(hash);
  if (known || !hash) return known;
  const missedAt = absent.get(hash);
  if ((missedAt && Date.now() - missedAt < ABSENT_TTL_MS) || refusalOf(hash)) return null;
  let pending = adopting.get(hash);
  if (!pending) {
    pending = adopt(hash).finally(() => adopting.delete(hash));
    adopting.set(hash, pending);
  }
  return pending;
}

/** Test hook: forget what Studio did or did not have. */
export function resetStudioCache(): void {
  absent.clear();
  refused.clear();
  listCache = null;
}
