import {
  ManifestError,
  manifestFacts,
  PROVENANCE_NOTES,
  provenanceCsv,
  sittingsByRelease,
  versionHistory,
  type ManifestFacts,
  type RegistryRecord,
  type SurveyVersionsResponse,
} from "@myself-dashboard/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireActor } from "../authz.js";
import { dash, STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { registryFacts, releaseList, ReleaseRejected, studioRelease } from "../releases.js";
import { currentRows } from "../store.js";
import { readStudio } from "../studio.js";
import { callableOptions } from "./common.js";

/**
 * The survey's version history (docs/11), read-only. Versions are edited and
 * published in MySelf Studio; this reads Studio's records of them, its live
 * pointer and audit trail, adds the versions only the dashboard's registry
 * knows, and counts the sittings under each from the dashboard's own
 * summaries — counts and dates, never a response.
 */

const HASH = /^sha256:[0-9a-f]{64}$/;

/** Facts of versions only Studio holds, by hash: a manifest never changes. */
const studioFacts = new Map<string, ManifestFacts>();

async function factsFor(hash: string, registered: boolean): Promise<ManifestFacts | { problem: string }> {
  try {
    if (registered) return (await registryFacts(hash)) ?? { problem: "The registry holds no manifest for this version." };
    const hit = studioFacts.get(hash);
    if (hit) return hit;
    const found = await studioRelease(hash);
    if (!found) return { problem: "Studio holds no manifest for this version, so sittings under it cannot be read." };
    const facts = manifestFacts(found.manifest);
    studioFacts.set(hash, facts);
    return facts;
  } catch (error) {
    if (error instanceof ReleaseRejected || error instanceof ManifestError) return { problem: `Not read: ${error.message}.` };
    throw error;
  }
}

async function history(now = new Date()): Promise<SurveyVersionsResponse> {
  const [studio, metas, { summaries }] = await Promise.all([readStudio(), releaseList(true), currentRows(now)]);
  const registry: RegistryRecord[] = metas.map((m) => ({ hash: m.hash, version: m.version, releaseKey: m.key, publishedAt: m.publishedAt, source: m.provenance?.source ?? "repository" }));
  const registered = new Set(registry.map((r) => r.hash));
  const hashes = new Set([...registered, ...studio.flatMap((s) => s.versions.map((v) => v.hash))]);
  const facts = new Map(await Promise.all([...hashes].map(async (h) => [h, await factsFor(h, registered.has(h))] as const)));
  return versionHistory({ studio, registry, sittings: sittingsByRelease(summaries.values()), facts, now });
}

const options = { ...callableOptions, memory: "512MiB" } as const;

export const listSurveyVersions = onCall(options, async (request): Promise<SurveyVersionsResponse> => {
  await requireActor(request, "survey.versions");
  return history();
});

/** Every version's provenance as CSV and JSON, audited. */
export const exportSurveyProvenance = onCall(options, async (request) => {
  const actor = await requireActor(request, "survey.versions");
  const h = await history();
  await audit({ action: "survey.provenance_exported", ...actorFields(actor), target: { type: "study", id: STUDY }, detail: { versions: h.versions.length } });
  const { computedAt, ...rest } = h;
  const json = { format: "myself-dashboard-provenance", formatVersion: 1, study: STUDY, exportedAt: computedAt, notes: PROVENANCE_NOTES, ...rest };
  return { csv: provenanceCsv(h.versions), json: JSON.stringify(json, null, 2) };
});

/** A version's manifest, to download: from the registry, or else Studio's checked copy. */
export const getSurveyManifest = onCall(options, async (request) => {
  await requireActor(request, "survey.versions");
  const hash = String((request.data as Record<string, unknown> | undefined)?.["hash"] ?? "");
  if (!HASH.test(hash)) throw new HttpsError("invalid-argument", "That is not a version's hash.");
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
  if (json) return { manifestJson: json };
  try {
    const found = await studioRelease(hash);
    if (found) return { manifestJson: found.json };
  } catch (error) {
    if (error instanceof ReleaseRejected) throw new HttpsError("failed-precondition", `Studio's copy of this version failed its checks, so it is not served: ${error.message}.`);
    throw error;
  }
  throw new HttpsError("not-found", "Neither the registry nor Studio holds that version.");
});
