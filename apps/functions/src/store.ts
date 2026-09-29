import { buildRows, type ReviewDoc, type SessionRow, type SessionSummary } from "@myself-dashboard/core";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { dash } from "./env.js";
import { dpaths } from "./paths.js";
import { studyPolicy } from "./settings.js";

/**
 * The in-memory mirror behind every list and metric (docs/02 §2.4).
 *
 * A warm instance holds every summary and review and brings them up to date at
 * the start of each request with one delta query on the server-set `_ts` field —
 * usually returning nothing, costing one read. A cold instance loads everything
 * once. A full reload every ten minutes heals anything a delta could miss.
 *
 * Firestore makes a committed write visible to every later query, and `_ts` is
 * the commit time, so `_ts >= last seen` cannot skip a document.
 */

class Mirror<T> {
  readonly items = new Map<string, T>();
  private last: Timestamp | null = null;
  private loadedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly path: () => string,
    private readonly db: () => Firestore,
    private readonly accept: (id: string, data: Record<string, unknown>) => T | null,
  ) {}

  sync(): Promise<void> {
    // Concurrent requests on one instance share one sync.
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<void> {
    const full = this.last === null || Date.now() - this.loadedAt > 10 * 60_000;
    const col = this.db().collection(this.path());
    const snap = full ? await col.get() : await col.where("_ts", ">=", this.last!).orderBy("_ts").get();
    if (full) {
      this.items.clear();
      this.loadedAt = Date.now();
    }
    for (const d of snap.docs) {
      const data = d.data();
      const ts = data["_ts"];
      if (ts instanceof Timestamp && (this.last === null || ts.toMillis() > this.last.toMillis())) this.last = ts;
      const value = this.accept(d.id, data);
      if (value === null) this.items.delete(d.id);
      else this.items.set(d.id, value);
    }
    if (full && this.last === null) this.last = Timestamp.fromMillis(0);
  }

  reset(): void {
    this.items.clear();
    this.last = null;
    this.loadedAt = 0;
  }
}

const strip = <T>(data: Record<string, unknown>): T => {
  const { _ts, ...rest } = data;
  void _ts;
  return rest as T;
};

const summaries = new Mirror<SessionSummary>(
  () => dpaths.summaries(),
  dash,
  (_id, data) => (data["deleted"] === true ? null : strip<SessionSummary>(data)),
);
const reviews = new Mirror<ReviewDoc>(() => dpaths.reviews(), dash, (_id, data) => strip<ReviewDoc>(data));

export async function currentRows(now = new Date()): Promise<{ rows: SessionRow[]; summaries: Map<string, SessionSummary>; reviews: Map<string, ReviewDoc> }> {
  const [policy] = await Promise.all([studyPolicy(), summaries.sync(), reviews.sync()]);
  return { rows: buildRows(summaries.items.values(), reviews.items, policy, now), summaries: summaries.items, reviews: reviews.items };
}

/** Test hook: forget everything so the next request reloads. */
export function resetStore(): void {
  summaries.reset();
  reviews.reset();
}
