import { provenanceCsv, type SurveyVersionView, type SurveyVersionsResponse } from "@myself-dashboard/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireActor } from "../authz.js";
import { dash, STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { releaseList } from "../releases.js";
import { currentRows } from "../store.js";
import { callableOptions } from "./common.js";

/**
 * The survey's version history (docs/11), read-only: every registered version
 * and the sittings recorded under it.
 */

const byVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

async function history(): Promise<SurveyVersionsResponse> {
  const [metas, { rows }] = await Promise.all([releaseList(true), currentRows(new Date())]);
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
  const versions: SurveyVersionView[] = metas
    .map((m) => ({
      hash: m.hash,
      version: m.version,
      releaseKey: m.key,
      publishedAt: m.publishedAt,
      sittings: sittings.get(m.hash)?.n ?? 0,
      firstSitting: sittings.get(m.hash)?.first ?? null,
      lastSitting: sittings.get(m.hash)?.last ?? null,
    }))
    .sort((a, b) => byVersion(a.version, b.version));
  return { versions };
}

export const listSurveyVersions = onCall(callableOptions, async (request): Promise<SurveyVersionsResponse> => {
  await requireActor(request, "survey.versions");
  return history();
});

export const exportSurveyProvenance = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "survey.versions");
  const h = await history();
  await audit({ action: "survey.provenance_exported", ...actorFields(actor), target: { type: "study", id: STUDY }, detail: { versions: h.versions.length } });
  return { csv: provenanceCsv(h.versions), json: JSON.stringify({ study: STUDY, exportedAt: new Date().toISOString(), ...h }, null, 2) };
});

/** A version's manifest, to download. */
export const getSurveyManifest = onCall({ ...callableOptions, memory: "512MiB" }, async (request) => {
  await requireActor(request, "survey.versions");
  const hash = String((request.data as Record<string, unknown> | undefined)?.["hash"] ?? "");
  const snap = await dash().doc(dpaths.releaseManifest(hash)).get();
  const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
  if (!json) throw new HttpsError("not-found", "That version is not in the registry.");
  return { manifestJson: json };
});
