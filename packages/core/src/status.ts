import { isTestCode, type Policy } from "./policy.js";
import type { ReviewDoc } from "./review.js";
import { REVIEW_WARNINGS, type SessionSummary } from "./summary.js";
import { LIFECYCLES, lifecycleOf, type Lifecycle } from "./vendor/myself/store/counting.js";

/**
 * Session status, derived when read (docs/03 §3.4).
 *
 * Not stored, because two of its inputs move on their own: "abandoned" depends
 * on the current time, and "needs review" on the review record.
 *
 * The lifecycle is the survey's `lifecycleOf` (vendored counting rules), the same
 * function its researcher view counts "reached the end" and "all required answered"
 * with. The markers are the dashboard's own: they depend on reviews, which only the
 * dashboard holds.
 */

export { LIFECYCLES, type Lifecycle };

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
  // The server's clock first: a device clock can be hours out (audit F4).
  const lifecycle: Lifecycle = lifecycleOf(
    {
      terminal: s.terminal,
      hasResponses: s.hasResponses,
      releaseKnown: s.releaseKnown,
      requiredMissing: s.counts.requiredMissing,
      receivedAt: s.receivedAt,
      lastActivityAt: s.lastActivityAt,
    },
    policy.abandonAfterHours,
    now,
  );

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

/**
 * Why a sitting is left out of every figure, if it is: quarantined by the survey (two
 * copies that contradict each other), or a log whose chunks are not all there.
 *
 * The survey's researcher view never receives either kind — its pull leaves them out
 * and says how many — so the Overview leaves them out too, and says how many, rather
 * than counting sittings nobody can yet say anything true about. They stay in the
 * session list, marked invalid, because somebody has to look at them.
 */
export function heldBackReason(s: Pick<SessionSummary, "quarantined" | "unreadable">): "quarantined" | "unreadable" | null {
  return s.quarantined ? "quarantined" : s.unreadable ? "unreadable" : null;
}

export function matchesStatus(d: DerivedStatus, wanted: DisplayStatus): boolean {
  return d.lifecycle === wanted || (d.markers as string[]).includes(wanted);
}
