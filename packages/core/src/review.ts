/**
 * Researcher review state for a sitting. Lives in the dashboard database,
 * separate from the participant's responses, and is never written back to them.
 */

export const REVIEW_STATUSES = ["unreviewed", "in_review", "needs_review", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "Unreviewed",
  in_review: "In review",
  needs_review: "Needs review",
  reviewed: "Reviewed",
};

export const FLAG_REASONS = [
  { id: "speeding", label: "Answered too quickly" },
  { id: "straightlining", label: "Same answer throughout (straight-lining)" },
  { id: "inconsistent", label: "Inconsistent answers" },
  { id: "duplicate", label: "Possible duplicate sitting" },
  { id: "wrong_code", label: "Wrong or mistyped study code" },
  { id: "technical", label: "Technical problem during the sitting" },
  { id: "clock", label: "Device clock problem" },
  { id: "consent", label: "Consent or eligibility query" },
  { id: "other", label: "Other (see note)" },
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number]["id"];
export const FLAG_REASON_IDS: readonly string[] = FLAG_REASONS.map((r) => r.id);

export const QUALITY_CONCERNS = [
  { id: "low_effort", label: "Low effort / inattentive responding" },
  { id: "partial_data", label: "Substantial missing data" },
  { id: "timing", label: "Implausible timing" },
  { id: "identity", label: "Participant identity uncertain" },
  { id: "environment", label: "Disrupted testing environment" },
  { id: "other", label: "Other" },
] as const;
export const QUALITY_CONCERN_IDS: readonly string[] = QUALITY_CONCERNS.map((c) => c.id);

export interface ReviewFlag {
  id: string;
  reason: FlagReason;
  note: string | null;
  open: boolean;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface ReviewDoc {
  sessionId: string;
  status: ReviewStatus;
  flags: ReviewFlag[];
  qualityConcerns: string[];
  markedTest: boolean;
  markedInvalid: boolean;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  noteCount: number;
  /** Increments on every change; the backend refuses a change based on a stale rev. */
  rev: number;
}

export const emptyReview = (sessionId: string): ReviewDoc => ({
  sessionId,
  status: "unreviewed",
  flags: [],
  qualityConcerns: [],
  markedTest: false,
  markedInvalid: false,
  lastReviewedAt: null,
  lastReviewedBy: null,
  updatedAt: null,
  updatedBy: null,
  noteCount: 0,
  rev: 0,
});

export type ReviewChange =
  | { kind: "set_status"; status: ReviewStatus }
  | { kind: "add_flag"; reason: FlagReason; note?: string | null }
  | { kind: "resolve_flag"; flagId: string }
  | { kind: "reopen_flag"; flagId: string }
  | { kind: "set_quality"; concerns: string[] }
  | { kind: "mark_test"; value: boolean }
  | { kind: "mark_invalid"; value: boolean };

export interface Actor {
  uid: string;
  email: string | null;
}

export class ReviewError extends Error {}

/**
 * Apply one change, returning the next document and what changed.
 *
 * Pure, so the rules it enforces (valid reasons, a note length limit, no
 * resolving a flag that does not exist) are tested without a database and are
 * identical wherever the change is applied.
 */
export function applyReviewChange(
  current: ReviewDoc,
  change: ReviewChange,
  actor: Actor,
  now: Date,
  newId: () => string,
): { next: ReviewDoc; before: Partial<ReviewDoc>; after: Partial<ReviewDoc> } {
  const at = now.toISOString();
  const next: ReviewDoc = { ...current, flags: current.flags.map((f) => ({ ...f })), qualityConcerns: [...current.qualityConcerns] };
  let before: Partial<ReviewDoc> = {};
  let after: Partial<ReviewDoc> = {};

  switch (change.kind) {
    case "set_status": {
      if (!(REVIEW_STATUSES as readonly string[]).includes(change.status)) throw new ReviewError("unknown review status");
      before = { status: current.status };
      next.status = change.status;
      if (change.status === "reviewed") {
        next.lastReviewedAt = at;
        next.lastReviewedBy = actor.uid;
      }
      after = { status: next.status };
      break;
    }
    case "add_flag": {
      if (!FLAG_REASON_IDS.includes(change.reason)) throw new ReviewError("unknown flag reason");
      const note = (change.note ?? "").trim();
      if (note.length > 1000) throw new ReviewError("a flag note is limited to 1,000 characters");
      if (change.reason === "other" && note.length === 0) throw new ReviewError("say what the problem is when the reason is 'Other'");
      if (next.flags.filter((f) => f.open).length >= 20) throw new ReviewError("resolve some open flags before adding more");
      const flag: ReviewFlag = {
        id: newId(),
        reason: change.reason,
        note: note || null,
        open: true,
        createdBy: actor.uid,
        createdByEmail: actor.email,
        createdAt: at,
        resolvedBy: null,
        resolvedAt: null,
      };
      next.flags.push(flag);
      if (next.status === "unreviewed" || next.status === "reviewed") next.status = "needs_review";
      before = { status: current.status };
      after = { status: next.status, flags: [flag] };
      break;
    }
    case "resolve_flag":
    case "reopen_flag": {
      const flag = next.flags.find((f) => f.id === change.flagId);
      if (!flag) throw new ReviewError("that flag does not exist");
      const open = change.kind === "reopen_flag";
      if (flag.open === open) throw new ReviewError(open ? "that flag is already open" : "that flag is already resolved");
      before = { flags: [{ ...flag }] };
      flag.open = open;
      flag.resolvedBy = open ? null : actor.uid;
      flag.resolvedAt = open ? null : at;
      after = { flags: [{ ...flag }] };
      break;
    }
    case "set_quality": {
      const concerns = [...new Set(change.concerns)];
      if (!concerns.every((c) => QUALITY_CONCERN_IDS.includes(c))) throw new ReviewError("unknown data-quality concern");
      before = { qualityConcerns: current.qualityConcerns };
      next.qualityConcerns = concerns.sort();
      after = { qualityConcerns: next.qualityConcerns };
      break;
    }
    case "mark_test": {
      before = { markedTest: current.markedTest };
      next.markedTest = change.value;
      after = { markedTest: next.markedTest };
      break;
    }
    case "mark_invalid": {
      before = { markedInvalid: current.markedInvalid };
      next.markedInvalid = change.value;
      after = { markedInvalid: next.markedInvalid };
      break;
    }
    default:
      throw new ReviewError("unknown change");
  }
  next.updatedAt = at;
  next.updatedBy = actor.uid;
  next.rev = current.rev + 1;
  return { next, before, after };
}

export const NOTE_MAX_CHARS = 4000;

export function validateNote(text: unknown): string {
  if (typeof text !== "string") throw new ReviewError("a note must be text");
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ReviewError("a note cannot be empty");
  if (trimmed.length > NOTE_MAX_CHARS) throw new ReviewError(`a note is limited to ${NOTE_MAX_CHARS.toLocaleString("en-GB")} characters`);
  return trimmed;
}
