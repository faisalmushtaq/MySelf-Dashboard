import { buildSummary, RULES_VERSION, type SessionSummary } from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { dash, REGION, research } from "./env.js";
import { dpaths, spaths } from "./paths.js";
import { resolveRelease } from "./releases.js";
import { assembleSitting, sittingStudyProblem } from "./sittings.js";
import { studyPolicy } from "./settings.js";
import { lookupStudy, registeredStudies } from "./studies.js";

/**
 * From a raw sitting to a de-identified summary.
 *
 * Runs on every write to a sitting in the survey's database — each checkpoint,
 * completion, quarantine — in any registered study, and writes one document to
 * that study's space in the dashboard's database (docs/12 §12.5). Idempotent:
 * the same sitting always produces the same summary, so a retried trigger is
 * harmless.
 */

export async function summariseSitting(
  study: string,
  sessionId: string,
  data: Record<string, unknown>,
  options: { backfill?: boolean; now?: Date } = {},
): Promise<SessionSummary> {
  const now = options.now ?? new Date();
  const [sitting, policy, previousSnap] = await Promise.all([
    assembleSitting(study, sessionId, data),
    studyPolicy(study),
    dash().doc(dpaths.summary(study, sessionId)).get(),
  ]);
  // A version the study's registry has not met yet may be one MySelf Studio published in
  // that study: resolveRelease checks Studio's copy against the sitting's hash and registers it (docs/11).
  const release = await resolveRelease(study, sitting.releaseHash);
  const previous = previousSnap.exists && !previousSnap.data()?.["deleted"] ? (previousSnap.data() as SessionSummary) : null;
  const { summary } = buildSummary(sitting, release, policy, { now, previous, backfill: options.backfill === true && !previous });
  const db = dash();
  const batch = db.batch();
  batch.set(db.doc(dpaths.summary(study, sessionId)), { ...summary, study, _ts: FieldValue.serverTimestamp() });
  batch.set(db.doc(dpaths.freshness(study)), { lastSummaryAt: FieldValue.serverTimestamp(), rulesVersion: RULES_VERSION }, { merge: true });
  await batch.commit();
  return summary;
}

/**
 * A sitting removed from the survey's database (withdrawal / erasure) removes its
 * summary too. A tombstone rather than a delete, so warm instances holding the
 * summary in memory learn that it has gone (store.ts).
 */
export async function removeSummary(study: string, sessionId: string): Promise<void> {
  await dash().doc(dpaths.summary(study, sessionId)).set({ sessionId, deleted: true, _ts: FieldValue.serverTimestamp() });
}

/** Enough of an id from a path to recognise it in a log, never a paragraph of it. */
const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 45)}…` : s);

/**
 * The trigger. A sitting is summarised only into its own study, and only when
 * that is a registered study (its registry document exists, or it is the
 * default) and the sitting does not name another one. Anything else is logged
 * and left alone: never summarised into another study.
 */
export async function onSitting(rawStudy: string, sessionId: string, after: Record<string, unknown> | null): Promise<"written" | "removed" | "ignored"> {
  const found = await lookupStudy(rawStudy);
  if (found.kind !== "registered") {
    logger.warn("a sitting outside any registered study was not summarised", { study: clip(rawStudy), sessionId: clip(sessionId), why: found.kind });
    return "ignored";
  }
  const study = found.study;
  if (!after) {
    await removeSummary(study, sessionId);
    logger.info("summary removed after the sitting was deleted from the survey database", { study, sessionId });
    return "removed";
  }
  const problem = sittingStudyProblem(study, after);
  if (problem) {
    logger.warn("a sitting that names another study was not summarised", { study, sessionId, why: problem });
    return "ignored";
  }
  const summary = await summariseSitting(study, sessionId, after);
  logger.info("summary written", { study, sessionId, releaseKnown: summary.releaseKnown, terminal: summary.terminal });
  return "written";
}

export const onSessionWritten = onDocumentWritten(
  { document: "studies/{study}/sessions/{sessionId}", database: "(default)", region: REGION, memory: "512MiB", timeoutSeconds: 120, retry: false },
  async (event) => {
    const after = event.data?.after;
    await onSitting(event.params.study, event.params.sessionId, after?.exists ? (after.data() as Record<string, unknown>) : null);
  },
);

export interface RebuildResult {
  scanned: number;
  written: number;
  unreadable: number;
  /** Sittings left alone because they name another study. */
  ignored: number;
}

/**
 * Summarise every sitting of one study again. Used once at first deployment
 * (backfill), after a new release is registered for sittings that arrived
 * before it, and when the completeness rules change. Read-only against the
 * survey's data.
 */
export async function rebuildAll(study: string, options: { onlyUnknownRelease?: boolean } = {}): Promise<RebuildResult> {
  let scanned = 0;
  let written = 0;
  let unreadable = 0;
  let ignored = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const pageSize = 200;
  for (;;) {
    let q = research().collection(spaths.sessions(study)).orderBy("__name__").limit(pageSize);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      scanned += 1;
      const data = doc.data() as Record<string, unknown>;
      if (sittingStudyProblem(study, data)) {
        ignored += 1;
        continue;
      }
      if (options.onlyUnknownRelease) {
        const existing = await dash().doc(dpaths.summary(study, doc.id)).get();
        if (existing.exists && existing.data()?.["releaseKnown"] === true && existing.data()?.["rulesVersion"] === RULES_VERSION) continue;
      }
      const s = await summariseSitting(study, doc.id, data, { backfill: true });
      written += 1;
      if (s.unreadable) unreadable += 1;
    }
    last = page.docs[page.docs.length - 1]!;
    if (page.size < pageSize) break;
  }
  return { scanned, written, unreadable, ignored };
}

/** Every registered study rebuilt, one after another: the setup workflow's backfill. */
export async function rebuildEveryStudy(): Promise<RebuildResult & { studies: Record<string, RebuildResult> }> {
  const total: RebuildResult = { scanned: 0, written: 0, unreadable: 0, ignored: 0 };
  const studies: Record<string, RebuildResult> = {};
  for (const { study } of await registeredStudies(true)) {
    const r = await rebuildAll(study);
    studies[study] = r;
    for (const k of Object.keys(total) as (keyof RebuildResult)[]) total[k] += r[k];
  }
  return { ...total, studies };
}
