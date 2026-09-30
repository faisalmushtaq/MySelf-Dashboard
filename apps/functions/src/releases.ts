import { indexRelease, parseManifest, type ReleaseIndex } from "@myself-dashboard/core";
import { verifyManifestHash } from "@myself-dashboard/core/node";
import { FieldValue } from "firebase-admin/firestore";
import { dash } from "./env.js";
import { dpaths } from "./paths.js";

/**
 * The release registry: every survey version the study has published, keyed by
 * its content hash. Metadata lives in `releases/{hash}` (readable by dashboard
 * users); the manifest itself in `releaseManifests/{hash}` (backend only).
 *
 * Manifests are immutable, so a parsed one is cached for the life of the
 * instance; the list of hashes is re-read at most once a minute.
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
}

const indexes = new Map<string, ReleaseIndex>();
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
  const index = indexRelease(JSON.parse(json), hash);
  indexes.set(hash, index);
  return index;
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

/**
 * Register a version. `provenance` is what the survey editor knows about how
 * the version was made — its base, why, what changed, who published it
 * (docs/11) — kept beside the metadata so the version history can be read
 * without opening a manifest.
 */
export async function registerRelease(raw: unknown, study: string, registeredBy: string, provenance: Record<string, unknown> = {}): Promise<ReleaseMeta> {
  const { meta, manifestJson } = prepareRelease(raw, study);
  const db = dash();
  const batch = db.batch();
  batch.set(db.doc(dpaths.releaseManifest(meta.hash, study)), { manifestJson });
  batch.set(db.doc(dpaths.release(meta.hash, study)), { ...meta, ...provenance, registeredAt: FieldValue.serverTimestamp(), registeredBy });
  await batch.commit();
  listCache = null;
  return meta;
}
