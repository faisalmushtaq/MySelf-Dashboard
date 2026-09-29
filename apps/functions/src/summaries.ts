import { buildSummary, RULES_VERSION, type SessionSummary } from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { dash, REGION, research, STUDY } from "./env.js";
import { dpaths, spaths } from "./paths.js";
import { releaseIndex } from "./releases.js";
import { assembleSitting } from "./sittings.js";
import { studyPolicy } from "./settings.js";

/**
 * From a raw sitting to a de-identified summary.
 *
 * Runs on every write to a sitting in the survey's database — each checkpoint,
 * completion, quarantine — and writes one document to the dashboard's database.
 * Idempotent: the same sitting always produces the same summary, so a retried
 * trigger is harmless.
 */

export async function summariseSitting(
  sessionId: string,
  data: Record<string, unknown>,
  options: { backfill?: boolean; now?: Date } = {},
): Promise<SessionSummary> {
  const now = options.now ?? new Date();
  const [sitting, policy, previousSnap] = await Promise.all([
    assembleSitting(sessionId, data),
    studyPolicy(),
    dash().doc(dpaths.summary(sessionId)).get(),
  ]);
  const release = await releaseIndex(sitting.releaseHash);
  const previous = previousSnap.exists && !previousSnap.data()?.["deleted"] ? (previousSnap.data() as SessionSummary) : null;
  const { summary } = buildSummary(sitting, release, policy, { now, previous, backfill: options.backfill === true && !previous });
  const db = dash();
  const batch = db.batch();
  batch.set(db.doc(dpaths.summary(sessionId)), { ...summary, study: STUDY, _ts: FieldValue.serverTimestamp() });
  batch.set(db.doc(dpaths.freshness()), { lastSummaryAt: FieldValue.serverTimestamp(), rulesVersion: RULES_VERSION }, { merge: true });
  await batch.commit();
  return summary;
}

/**
 * A sitting removed from the survey's database (withdrawal / erasure) removes its
 * summary too. A tombstone rather than a delete, so warm instances holding the
 * summary in memory learn that it has gone (store.ts).
 */
export async function removeSummary(sessionId: string): Promise<void> {
  await dash().doc(dpaths.summary(sessionId)).set({ sessionId, deleted: true, _ts: FieldValue.serverTimestamp() });
}

export const onSessionWritten = onDocumentWritten(
  { document: "studies/{study}/sessions/{sessionId}", database: "(default)", region: REGION, memory: "512MiB", timeoutSeconds: 120, retry: false },
  async (event) => {
    if (event.params.study !== STUDY) return;
    const sessionId = event.params.sessionId;
    const after = event.data?.after;
    if (!after || !after.exists) {
      await removeSummary(sessionId);
      logger.info("summary removed after the sitting was deleted from the survey database", { sessionId });
      return;
    }
    const summary = await summariseSitting(sessionId, after.data() as Record<string, unknown>);
    logger.info("summary written", { sessionId, releaseKnown: summary.releaseKnown, terminal: summary.terminal });
  },
);

/**
 * Summarise every sitting again. Used once at first deployment (backfill), after a
 * new release is registered for sittings that arrived before it, and when the
 * completeness rules change. Read-only against the survey's data.
 */
export async function rebuildAll(options: { onlyUnknownRelease?: boolean } = {}): Promise<{ scanned: number; written: number; unreadable: number }> {
  let scanned = 0;
  let written = 0;
  let unreadable = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const pageSize = 200;
  for (;;) {
    let q = research().collection(spaths.sessions()).orderBy("__name__").limit(pageSize);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      scanned += 1;
      if (options.onlyUnknownRelease) {
        const existing = await dash().doc(dpaths.summary(doc.id)).get();
        if (existing.exists && existing.data()?.["releaseKnown"] === true && existing.data()?.["rulesVersion"] === RULES_VERSION) continue;
      }
      const s = await summariseSitting(doc.id, doc.data() as Record<string, unknown>, { backfill: true });
      written += 1;
      if (s.unreadable) unreadable += 1;
    }
    last = page.docs[page.docs.length - 1]!;
    if (page.size < pageSize) break;
  }
  return { scanned, written, unreadable };
}
