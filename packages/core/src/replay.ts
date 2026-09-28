import type { Sitting, SittingEvent } from "./types.js";

/**
 * Replaying a sitting's event log into per-question facts.
 *
 * Same rule as the survey's `ingest` replay: events in `seq` order, and the last
 * statement about an item wins — which is how the participant experienced it.
 * Nothing here judges completeness; it only records what happened.
 */

export type ResponseKind = "answered" | "skipped" | "declined";

export interface ItemFacts {
  key: string;
  /** Last response statement, or null when the item never received one. */
  response: ResponseKind | null;
  /** Raw recorded value (server-side only — may be identifying or free text). */
  value: unknown;
  presentedCount: number;
  firstPresentedAt?: string;
  lastPresentedSeq?: number;
  respondedAt?: string;
  changed: boolean;
  tooFast: boolean;
  inconsistent: boolean;
  dwellMs?: number;
}

export interface ReplayResult {
  items: Map<string, ItemFacts>;
  /** The survey reached its end (`complete` flag or a `session.completed` event). */
  terminal: boolean;
  completedEvent: boolean;
  hasPresentationEvents: boolean;
  /** Latest device timestamp of any event. */
  lastActivityAt?: string;
  /** Latest device timestamp of a response event. */
  lastResponseAt?: string;
  firstEventAt?: string;
  durationMs?: number;
  foregroundMs?: number;
  wallClockMs?: number;
  resumedCount: number;
  reviewEdits: number;
  backNavigations: number;
  tooFastCount: number;
  inconsistentCount: number;
  eventCount: number;
  /** Events whose timestamp could not be parsed. */
  badTimestamps: number;
}

const isoOrUndefined = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
};

export function replaySitting(sitting: Pick<Sitting, "events" | "complete">): ReplayResult {
  const items = new Map<string, ItemFacts>();
  const at = (key: string): ItemFacts => {
    let f = items.get(key);
    if (!f) {
      f = { key, response: null, value: undefined, presentedCount: 0, changed: false, tooFast: false, inconsistent: false };
      items.set(key, f);
    }
    return f;
  };

  let completedEvent = false;
  let hasPresentationEvents = false;
  let durationMs: number | undefined;
  let foregroundMs: number | undefined;
  let resumedCount = 0;
  let reviewEdits = 0;
  let backNavigations = 0;
  let tooFastCount = 0;
  let inconsistentCount = 0;
  let badTimestamps = 0;
  let last: number | undefined;
  let first: number | undefined;
  let lastResponse: number | undefined;

  const ordered: SittingEvent[] = [...(sitting.events ?? [])].sort((a, b) => a.seq - b.seq);
  for (const e of ordered) {
    const t = isoOrUndefined(e.tWall);
    if (t === undefined) badTimestamps += 1;
    else {
      last = last === undefined ? t : Math.max(last, t);
      first = first === undefined ? t : Math.min(first, t);
    }
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "item.presented": {
        hasPresentationEvents = true;
        if (!e.itemKey) break;
        const f = at(e.itemKey);
        f.presentedCount += 1;
        f.firstPresentedAt ??= e.tWall;
        f.lastPresentedSeq = e.seq;
        break;
      }
      case "response.recorded":
      case "response.changed": {
        if (!e.itemKey) break;
        const f = at(e.itemKey);
        // A second statement about an answered item is a change, whichever event
        // type the device used for it.
        if (e.type === "response.changed" || f.response === "answered") f.changed = true;
        f.response = "answered";
        f.value = p["value"];
        f.respondedAt = e.tWall;
        if ((p["timing"] as { tooFast?: boolean } | undefined)?.tooFast) f.tooFast = true;
        if (t !== undefined) lastResponse = lastResponse === undefined ? t : Math.max(lastResponse, t);
        break;
      }
      case "item.skipped":
      case "item.declined": {
        if (!e.itemKey) break;
        const f = at(e.itemKey);
        f.response = e.type === "item.skipped" ? "skipped" : "declined";
        f.value = undefined;
        f.respondedAt = e.tWall;
        if (t !== undefined) lastResponse = lastResponse === undefined ? t : Math.max(lastResponse, t);
        break;
      }
      case "item.left": {
        if (!e.itemKey) break;
        const total = p["totalDwellMs"];
        if (typeof total === "number") at(e.itemKey).dwellMs = total;
        break;
      }
      case "response.too_fast":
        tooFastCount += 1;
        if (e.itemKey) at(e.itemKey).tooFast = true;
        break;
      case "response.inconsistent":
        inconsistentCount += 1;
        if (e.itemKey) at(e.itemKey).inconsistent = true;
        break;
      case "review.edited":
        reviewEdits += 1;
        break;
      case "navigation.back":
        backNavigations += 1;
        break;
      case "session.resumed":
        resumedCount += 1;
        break;
      case "session.completed": {
        completedEvent = true;
        if (typeof p["totalMs"] === "number") durationMs = p["totalMs"] as number;
        if (typeof p["foregroundMs"] === "number") foregroundMs = p["foregroundMs"] as number;
        break;
      }
    }
  }

  return {
    items,
    terminal: sitting.complete === true || completedEvent,
    completedEvent,
    hasPresentationEvents,
    ...(last !== undefined ? { lastActivityAt: new Date(last).toISOString() } : {}),
    ...(lastResponse !== undefined ? { lastResponseAt: new Date(lastResponse).toISOString() } : {}),
    ...(first !== undefined ? { firstEventAt: new Date(first).toISOString() } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(foregroundMs !== undefined ? { foregroundMs } : {}),
    ...(first !== undefined && last !== undefined && last > first ? { wallClockMs: last - first } : {}),
    resumedCount,
    reviewEdits,
    backNavigations,
    tooFastCount,
    inconsistentCount,
    eventCount: ordered.length,
    badTimestamps,
  };
}
