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

export async function assembleSitting(id: string, data: Record<string, unknown>): Promise<Sitting> {
  const doc = normaliseDoc(id, data);
  const chunkCount = doc.chunkCount ?? 0;
  if (chunkCount === 0) return { ...doc, events: doc.events ?? [] };
  const chunks = await research().collection(spaths.chunks(doc.sessionId)).get();
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

export async function readSitting(id: string): Promise<Sitting | null> {
  const snap = await research().doc(spaths.session(id)).get();
  if (!snap.exists) return null;
  return assembleSitting(id, snap.data() as Record<string, unknown>);
}

/** Many sittings, in batches, for exports. */
export async function readSittings(ids: readonly string[]): Promise<Map<string, Sitting>> {
  const out = new Map<string, Sitting>();
  const db = research();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.doc(spaths.session(id)));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      out.set(s.id, await assembleSitting(s.id, s.data() as Record<string, unknown>));
    }
  }
  return out;
}
