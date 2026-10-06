import type { Sitting, SittingDoc, SittingEvent } from "@myself-dashboard/core";
import { Timestamp } from "firebase-admin/firestore";
import { research } from "./env.js";
import { spaths } from "./paths.js";

/**
 * Reading a raw sitting from the survey's database — server-side only.
 *
 * Mirrors `joinSession` in the survey's layout.ts: a spilled log is reassembled
 * from its chunks, and one whose chunks are not all present is NOT returned short
 * — it is marked unreadable, because a truncated log that looks complete would be
 * analysed and nothing downstream could tell.
 */

const iso = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v instanceof Timestamp ? v.toDate().toISOString() : undefined;

export function normaliseDoc(id: string, data: Record<string, unknown>): SittingDoc {
  return {
    sessionId: typeof data["sessionId"] === "string" ? (data["sessionId"] as string) : id,
    ...(typeof data["deviceId"] === "string" ? { deviceId: data["deviceId"] as string } : {}),
    ...(typeof data["study"] === "string" ? { study: data["study"] as string } : {}),
    ...(typeof data["studyCode"] === "string" ? { studyCode: data["studyCode"] as string } : {}),
    ...(typeof data["releaseKey"] === "string" ? { releaseKey: data["releaseKey"] as string } : {}),
    ...(typeof data["releaseHash"] === "string" ? { releaseHash: data["releaseHash"] as string } : {}),
    ...(iso(data["startedAt"]) ? { startedAt: iso(data["startedAt"])! } : {}),
    ...(iso(data["completedAt"]) ? { completedAt: iso(data["completedAt"])! } : {}),
    complete: data["complete"] === true,
    events: Array.isArray(data["events"]) ? (data["events"] as SittingEvent[]) : [],
    chunkCount: typeof data["chunkCount"] === "number" ? (data["chunkCount"] as number) : 0,
    ...(typeof data["eventCount"] === "number" ? { eventCount: data["eventCount"] as number } : {}),
    ...(iso(data["receivedAt"]) ? { receivedAt: iso(data["receivedAt"])! } : {}),
    quarantined: data["quarantined"] === true,
    ...(typeof data["provenance"] === "string" ? { provenance: data["provenance"] as string } : {}),
  };
}

/**
 * Why a sitting found under `studies/{study}/sessions` is not that study's, or
 * null when it is. Its own `study` field, when it has one, must be the path's
 * (survey docs/16 §11.6): a sitting that names another study is malformed and
 * is never read as either's.
 */
export function sittingStudyProblem(study: string, data: Record<string, unknown>): string | null {
  const own = data["study"];
  if (own === undefined || own === null || own === study) return null;
  return typeof own === "string" ? "names another study" : "names its study in a form no study id takes";
}

export async function assembleSitting(study: string, id: string, data: Record<string, unknown>): Promise<Sitting> {
  const doc = normaliseDoc(id, data);
  const chunkCount = doc.chunkCount ?? 0;
  if (chunkCount === 0) return { ...doc, events: doc.events ?? [] };
  const chunks = await research().collection(spaths.chunks(study, doc.sessionId)).get();
  const byIndex = new Map<number, SittingEvent[]>();
  for (const c of chunks.docs) {
    const d = c.data() as { index?: number; events?: SittingEvent[] };
    if (typeof d.index === "number" && Array.isArray(d.events)) byIndex.set(d.index, d.events);
  }
  for (let i = 0; i < chunkCount; i += 1) {
    if (!byIndex.has(i)) return { ...doc, events: [], unreadable: true };
  }
  const events = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => e);
  return { ...doc, events };
}

/** One of `study`'s sittings; null when it has none by that id, or the one it has names another study. */
export async function readSitting(study: string, id: string): Promise<Sitting | null> {
  const snap = await research().doc(spaths.session(study, id)).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (sittingStudyProblem(study, data)) return null;
  return assembleSitting(study, id, data);
}

/** Many of `study`'s sittings, in batches, for exports. */
export async function readSittings(study: string, ids: readonly string[]): Promise<Map<string, Sitting>> {
  const out = new Map<string, Sitting>();
  const db = research();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.doc(spaths.session(study, id)));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const data = s.data() as Record<string, unknown>;
      if (sittingStudyProblem(study, data)) continue;
      out.set(s.id, await assembleSitting(study, s.id, data));
    }
  }
  return out;
}
