import { createHash } from "node:crypto";
import type { Sitting } from "@myself-dashboard/core";
import {
  deriveStudyDataset,
  parseSurveyManifest,
  pseudonymiseDataset,
  subsetDataset,
  type ReleaseManifest,
  type StoredNarrativeRun,
  type StudyDataset,
} from "@myself-dashboard/core/survey";
import { dash, research } from "./env.js";
import { dpaths, spaths } from "./paths.js";
import { releaseList } from "./releases.js";
import { readSittings } from "./sittings.js";
import { currentRows } from "./store.js";

/**
 * A study as the survey's own export sees it: participant codes, waves,
 * corrections and twin assignments applied (packages/core/src/survey). One
 * study at a time: participants are linked within a study, never across two.
 *
 * Built from raw sittings, server-side only. Cached for a few minutes because
 * it reads every sitting; exports ask for a fresh copy.
 */

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const manifests = new Map<string, { manifest: ReleaseManifest } | { error: string }>();

/** Every release registered in `study` that the survey's schema can read, by hash. */
export async function surveyManifests(study: string): Promise<Map<string, ReleaseManifest>> {
  const out = new Map<string, ReleaseManifest>();
  for (const meta of await releaseList(study)) {
    const key = `${study} ${meta.hash}`;
    let parsed = manifests.get(key);
    if (!parsed) {
      const snap = await dash().doc(dpaths.releaseManifest(study, meta.hash)).get();
      const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
      parsed = json ? parseSurveyManifest(JSON.parse(json)) : { error: "manifest missing" };
      manifests.set(key, parsed);
    }
    if ("manifest" in parsed) out.set(meta.hash, parsed.manifest);
  }
  return out;
}

async function linkageRecords(study: string): Promise<{ aliases: Record<string, string>; assignments: Record<string, string> }> {
  const [corr, assign] = await Promise.all([research().collection(spaths.corrections(study)).get(), research().collection(spaths.assignments(study)).get()]);
  const aliases: Record<string, string> = {};
  for (const d of corr.docs) {
    const c = d.data() as { wrongCode?: string; rightCode?: string; withdrawnAt?: unknown };
    if (!c.withdrawnAt && c.wrongCode && c.rightCode) aliases[c.wrongCode] = c.rightCode;
  }
  const assignments: Record<string, string> = {};
  for (const d of assign.docs) {
    const code = (d.data() as { participantCode?: string }).participantCode;
    if (code) assignments[d.id] = code;
  }
  return { aliases, assignments };
}

export async function readNarratives(study: string): Promise<StoredNarrativeRun[]> {
  const snap = await research().collection(spaths.narratives(study)).get();
  return snap.docs.map((d) => d.data() as StoredNarrativeRun);
}

const cache = new Map<string, { at: number; startMonth: number; value: { study: StudyDataset; sittings: Map<string, Sitting> } }>();
const TTL_MS = 5 * 60_000;

export async function loadStudyDataset(
  study: string,
  options: { fresh?: boolean; onProgress?: (fraction: number) => Promise<void>; schoolYearStartMonth?: number } = {},
): Promise<{ study: StudyDataset; sittings: Map<string, Sitting> }> {
  const hit = cache.get(study);
  const startMonth = options.schoolYearStartMonth ?? hit?.startMonth ?? 9;
  if (!options.fresh && hit && hit.startMonth === startMonth && Date.now() - hit.at < TTL_MS) return hit.value;
  const { rows } = await currentRows(study);
  const ids = rows.map((r) => r.summary.sessionId);
  const sittings = new Map<string, Sitting>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const [id, s] of await readSittings(study, ids.slice(i, i + 200))) sittings.set(id, s);
    await options.onProgress?.(Math.min(1, (i + 200) / Math.max(1, ids.length)));
  }
  const [releases, links] = await Promise.all([surveyManifests(study), linkageRecords(study)]);
  const dataset = deriveStudyDataset({ study, sittings: [...sittings.values()], manifests: releases, ...links, schoolYearStartMonth: startMonth });
  const value = { study: dataset, sittings };
  cache.set(study, { at: Date.now(), startMonth, value });
  return value;
}

/** Test hook. */
export function resetStudyDataset(study?: string): void {
  if (study) cache.delete(study);
  else cache.clear();
  if (!study) manifests.clear();
}

/**
 * Participant and wave for each chosen sitting: the code, or — de-identified —
 * a label that means nothing outside the export.
 */
export function participantsFor(study: StudyDataset, sessionIds: readonly string[], deidentified: boolean): Map<string, { participant: string; wave: number }> {
  const chosen = new Set(sessionIds);
  let data = subsetDataset(study.dataset, chosen);
  if (deidentified) data = pseudonymiseDataset(data).dataset;
  return new Map(data.sessions.map((s) => [s.sessionId, { participant: s.participantId, wave: s.wave }]));
}
