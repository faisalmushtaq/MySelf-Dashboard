/**
 * The sitting as the survey stores it in Firestore `(default)`.
 *
 * Mirrors `SessionDoc` in faisalmushtaq/MySelf `packages/firebase/src/layout.ts`,
 * but every field is optional: this is a READER of data somebody else writes, and a
 * reader that throws on an unexpected shape turns one odd document into a blank
 * dashboard. Absent fields are reported as data-quality warnings instead.
 */
export interface SittingEvent {
  seq: number;
  type: string;
  /** "<instrument>.<item>" for item-scoped events. */
  itemKey?: string;
  payload?: Record<string, unknown>;
  /** Device wall clock (ISO 8601). */
  tWall: string;
  /** Monotonic milliseconds since the app session started. */
  tMono: number;
}

export interface SittingDoc {
  sessionId: string;
  deviceId?: string;
  study?: string;
  studyCode?: string;
  releaseKey?: string;
  releaseHash?: string;
  startedAt?: string;
  completedAt?: string;
  complete?: boolean;
  events?: SittingEvent[];
  chunkCount?: number;
  eventCount?: number;
  /** Server clock, overwritten on every upload: "last received". */
  receivedAt?: string;
  quarantined?: boolean;
  provenance?: "device" | "imported" | string;
}

/** A sitting reassembled from its document and any chunks. */
export interface Sitting extends SittingDoc {
  events: SittingEvent[];
  /** True when the document claims chunks that could not all be read. */
  unreadable?: boolean;
}
