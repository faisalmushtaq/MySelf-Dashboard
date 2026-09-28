import { isTestCode, type Policy } from "./policy.js";
import type { ReviewDoc } from "./review.js";
import { REVIEW_WARNINGS, type SessionSummary } from "./summary.js";

/**
 * Session status, derived when read (docs/03 §3.4).
 *
 * Not stored, because two of its inputs move on their own: "abandoned" depends
 * on the current time, and "needs review" on the review record.
 */

export const LIFECYCLES = ["not_started", "in_progress", "abandoned", "incomplete", "complete"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const MARKERS = ["invalid", "test", "needs_review"] as const;
export type Marker = (typeof MARKERS)[number];

export type DisplayStatus = Lifecycle | Marker;
export const DISPLAY_STATUSES: readonly DisplayStatus[] = [...LIFECYCLES, ...MARKERS];

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  abandoned: "Abandoned",
  incomplete: "Incomplete",
  complete: "Complete",
  invalid: "Invalid",
  test: "Test session",
  needs_review: "Needs review",
};

export const STATUS_HELP: Record<DisplayStatus, string> = {
  not_started: "Opened, but no question has been answered, skipped or declined.",
  in_progress: "Not finished, and the study has heard from the device within the abandonment window.",
  abandoned: "Not finished, and not heard from for longer than the abandonment window.",
  incomplete: "Reached the end of the survey with at least one missing required answer.",
  complete: "Reached the end of the survey with every applicable required question answered or declined.",
  invalid: "Quarantined by the survey, unreadable, or marked invalid by a researcher. Excluded from completion rates.",
  test: "A test sitting: study code matches a test pattern, or marked as test by a researcher.",
  needs_review: "Flagged, set to 'Needs review', or carrying an automatic data-quality signal that nobody has reviewed yet.",
};

export interface DerivedStatus {
  lifecycle: Lifecycle;
  markers: Marker[];
  display: DisplayStatus;
  /** Data-quality signals active under the current policy (stored warnings + policy-dependent ones). */
  signals: string[];
  openFlags: number;
}

const MARKER_PRECEDENCE: Marker[] = ["invalid", "test", "needs_review"];

export function deriveStatus(
  s: SessionSummary,
  review: ReviewDoc | null | undefined,
  policy: Pick<Policy, "abandonAfterHours" | "testCodePatterns" | "tooFastWarningCount">,
  now: Date,
): DerivedStatus {
  let lifecycle: Lifecycle;
  if (s.terminal) {
    lifecycle = s.releaseKnown && s.counts.requiredMissing > 0 ? "incomplete" : "complete";
  } else if (!s.hasResponses) {
    lifecycle = "not_started";
  } else {
    const heard = [s.receivedAt, s.lastActivityAt]
      .map((t) => (t ? Date.parse(t) : NaN))
      .filter((t) => Number.isFinite(t));
    // The server's clock first: a device clock can be hours out (audit F4).
    const lastHeard = s.receivedAt && Number.isFinite(Date.parse(s.receivedAt)) ? Date.parse(s.receivedAt) : Math.max(...heard, -Infinity);
    const windowMs = policy.abandonAfterHours * 3_600_000;
    lifecycle = Number.isFinite(lastHeard) && now.getTime() - lastHeard <= windowMs ? "in_progress" : "abandoned";
  }

  const signals = [...s.warnings];
  if (s.tooFastCount >= policy.tooFastWarningCount && !signals.includes("too_fast")) signals.push("too_fast");

  const openFlags = review?.flags.filter((f) => f.open).length ?? 0;
  const markers = new Set<Marker>();
  if (s.quarantined || s.unreadable || review?.markedInvalid) markers.add("invalid");
  if (review?.markedTest || isTestCode(s.studyCode ?? undefined, policy)) markers.add("test");
  const reviewStatus = review?.status ?? "unreviewed";
  if (
    reviewStatus === "needs_review" ||
    (openFlags > 0 && reviewStatus !== "reviewed") ||
    (reviewStatus === "unreviewed" && signals.some((w) => REVIEW_WARNINGS.has(w)))
  ) {
    markers.add("needs_review");
  }
  const ordered = MARKER_PRECEDENCE.filter((m) => markers.has(m));
  return { lifecycle, markers: ordered, display: ordered[0] ?? lifecycle, signals: signals.sort(), openFlags };
}

export function matchesStatus(d: DerivedStatus, wanted: DisplayStatus): boolean {
  return d.lifecycle === wanted || (d.markers as string[]).includes(wanted);
}
