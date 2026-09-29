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
import { dash, research, STUDY } from "./env.js";
import { dpaths, spaths } from "./paths.js";
import { releaseList } from "./releases.js";
import { readSittings } from "./sittings.js";
import { currentRows } from "./store.js";

/**
 * The study as the survey's own export sees it: participant codes, waves,
 * corrections and twin assignments applied (packages/core/src/survey).
 *
 * Built from raw sittings, server-side only. Cached for a few minutes because
 * it reads every sitting; exports ask for a fresh copy.
 */

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const manifests = new Map<string, { manifest: ReleaseManifest } | { error: string }>();

/** Every registered release that the survey's schema can read, by hash. */
export async function surveyManifests(): Promise<Map<string, ReleaseManifest>> {
  const out = new Map<string, ReleaseManifest>();
  for (const meta of await releaseList()) {
    let parsed = manifests.get(meta.hash);
    if (!parsed) {
      const snap = await dash().doc(dpaths.releaseManifest(meta.hash)).get();
      const json = (snap.data() as { manifestJson?: string } | undefined)?.manifestJson;
      parsed = json ? parseSurveyManifest(JSON.parse(json)) : { error: "manifest missing" };
      manifests.set(meta.hash, parsed);
    }
    if ("manifest" in parsed) out.set(meta.hash, parsed.manifest);
  }
  return out;
}

async function linkageRecords(): Promise<{ aliases: Record<string, string>; assignments: Record<string, string> }> {
  const [corr, assign] = await Promise.all([research().collection(spaths.corrections()).get(), research().collection(spaths.assignments()).get()]);
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

export async function readNarratives(): Promise<StoredNarrativeRun[]> {
  const snap = await research().collection(spaths.narratives()).get();
  return snap.docs.map((d) => d.data() as StoredNarrativeRun);
}

let cache: { at: number; value: { study: StudyDataset; sittings: Map<string, Sitting> } } | null = null;
const TTL_MS = 5 * 60_000;

export async function loadStudyDataset(options: { fresh?: boolean; onProgress?: (fraction: number) => Promise<void> } = {}): Promise<{ study: StudyDataset; sittings: Map<string, Sitting> }> {
  if (!options.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { rows } = await currentRows();
  const ids = rows.map((r) => r.summary.sessionId);
  const sittings = new Map<string, Sitting>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const [id, s] of await readSittings(ids.slice(i, i + 200))) sittings.set(id, s);
    await options.onProgress?.(Math.min(1, (i + 200) / Math.max(1, ids.length)));
  }
  const [releases, links] = await Promise.all([surveyManifests(), linkageRecords()]);
  const study = deriveStudyDataset({ study: STUDY, sittings: [...sittings.values()], manifests: releases, ...links });
  const value = { study, sittings };
  cache = { at: Date.now(), value };
  return value;
}

/** Test hook. */
export function resetStudyDataset(): void {
  cache = null;
  manifests.clear();
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
