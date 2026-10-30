import { assessSitting, OUTCOMES, type Assessment, type Counts, type Outcome } from "./completeness.js";
import type { ReleaseIndex, RequiredLevel } from "./manifest.js";
import type { Policy } from "./policy.js";
import { replaySitting, type ReplayResult } from "./replay.js";
import type { Sitting } from "./types.js";

/**
 * The de-identified record the dashboard keeps for every sitting.
 *
 * Written by the backend into the `dashboard` database; never readable from a
 * browser directly. It holds FACTS — no identifying values and no free text — so
 * that every list, filter and metric can be computed without touching a raw log.
 *
 * Every field is present (null rather than absent): Firestore queries silently
 * skip documents that lack a field, which is how "not quarantined" once returned
 * an empty study in the survey repo (layout.ts).
 */

/** One question's outcome, compacted. `o` indexes OUTCOMES. */
export interface ItemEntry {
  k: string;
  o: number;
  /** Option code or number, for non-identifying, non-free-text answers. */
  v?: number;
  /** Option codes of a multi-choice answer. */
  m?: number[];
  /** 1 when the question was shown at least once. */
  s?: 1;
}

export interface SectionSummary {
  key: string;
  required: number;
  resolved: number;
  eligible: number;
  reached: boolean;
  applicable: boolean;
}

export interface SessionSummary {
  sessionId: string;
  study: string;
  studyCode: string | null;
  site: string | null;
  deviceId: string | null;
  releaseHash: string | null;
  releaseKey: string | null;
  releaseVersion: string | null;
  releaseKnown: boolean;
  provenance: string | null;
  quarantined: boolean;
  unreadable: boolean;
  terminal: boolean;
  hasResponses: boolean;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  lastResponseAt: string | null;
  receivedAt: string | null;
  firstReceivedAt: string | null;
  backfilled: boolean;
  durationMs: number | null;
  foregroundMs: number | null;
  wallClockMs: number | null;
  resumedCount: number;
  reviewEdits: number;
  backNavigations: number;
  tooFastCount: number;
  inconsistentCount: number;
  eventCount: number;
  counts: Counts;
  requiredCompletion: number | null;
  answeredRate: number | null;
  estimated: boolean;
  estimateReasons: string[];
  sections: SectionSummary[];
  missingRequiredKeys: string[];
  invalidKeys: string[];
  lastPresentedKey: string | null;
  finalSectionKey: string | null;
  unknownItemKeys: string[];
  /** Policy-independent data-quality facts; see WARNING_LABELS. */
  warnings: string[];
  /**
   * A researcher ended the sitting on the iPad before the end (survey D-70), and
   * why. Null otherwise; absent on summaries written before this existed.
   */
  endedByStaff?: { reason: string; at: string | null } | null;
  items: ItemEntry[];
  requiredLevels: RequiredLevel[];
  rulesVersion: string;
  summarisedAt: string;
}

export const WARNING_LABELS: Record<string, string> = {
  quarantined: "Quarantined by the survey: two contradicting copies of this sitting exist",
  unreadable: "The stored log is missing chunks and cannot be read in full",
  unknown_release: "This sitting's survey version is not in the dashboard's registry",
  release_mismatch: "The version recorded at the start of the log differs from the sitting's version",
  unknown_items: "The log contains question ids this version does not define",
  invalid_answers: "One or more recorded answers do not fit this version's definition",
  clock_ahead: "The device clock was ahead of the server: device times may be wrong",
  bad_timestamps: "Some event timestamps could not be read",
  too_fast: "Many answers were given faster than they could be read",
  inconsistent: "The participant gave answers the survey flagged as contradicting each other",
  resumed: "The sitting was interrupted and resumed; device-measured duration covers the last stretch only",
  no_presentation_events: "The log has no question-presentation events (legacy); shown/not-shown is inferred",
  imported: "Filed from a handover file rather than uploaded by the device",
  backfilled: "Summarised after the fact; first-received time is approximate",
  // A researcher ended the sitting on the iPad (survey D-70), one code per reason chosen there.
  ended_by_researcher_time: "Ended by a researcher: time was up",
  ended_by_researcher_participant_stopped: "Ended by a researcher: the participant asked to stop",
  ended_by_researcher_distress: "Ended by a researcher: the participant was upset or unwell",
  ended_by_researcher_technical: "Ended by a researcher: a technical problem",
  ended_by_researcher_other: "Ended by a researcher",
};

/** The reasons a researcher can give on the iPad when ending a sitting (survey D-70), in words. */
export const ENDED_REASON_LABELS: Record<string, string> = {
  time: "Time was up",
  participant_stopped: "The participant asked to stop",
  distress: "The participant was upset or unwell",
  technical: "Technical problem",
  other: "Something else",
};

/** The warning code for a researcher's wrap-up with this reason. */
export function endedWarning(reason: string): string {
  return ENDED_REASON_LABELS[reason] && reason !== "other" ? `ended_by_researcher_${reason}` : "ended_by_researcher_other";
}

/** Warnings that, on an unreviewed sitting, mark it as needing review. */
export const REVIEW_WARNINGS: ReadonlySet<string> = new Set([
  "invalid_answers",
  "unknown_items",
  "clock_ahead",
  "release_mismatch",
  "inconsistent",
  "too_fast",
]);

/** Five minutes of tolerance, as the survey's own clock check uses (sittings.ts). */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export function siteOf(studyCode: string | null | undefined): string | null {
  const m = /^([A-Za-z]{2,})/.exec(studyCode ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export interface SummaryOptions {
  now: Date;
  previous?: SessionSummary | null;
  /** True when summarising a sitting that already existed before the dashboard saw it. */
  backfill?: boolean;
}

const OUTCOME_CODE = new Map<Outcome, number>(OUTCOMES.map((o, i) => [o, i]));

export function buildSummary(
  sitting: Sitting,
  release: ReleaseIndex | null,
  policy: Pick<Policy, "requiredLevels">,
  options: SummaryOptions,
): { summary: SessionSummary; assessment: Assessment; replay: ReplayResult } {
  const replay = replaySitting(sitting);
  const assessment = assessSitting(replay, release, {
    requiredLevels: policy.requiredLevels,
    sittingStart: sitting.startedAt ?? replay.firstEventAt ?? null,
  });

  const warnings = new Set<string>();
  if (sitting.quarantined) warnings.add("quarantined");
  if (sitting.unreadable) warnings.add("unreadable");
  if (!release) warnings.add("unknown_release");
  if (assessment.unknownItemKeys.length > 0) warnings.add("unknown_items");
  if (assessment.counts.invalid > 0) warnings.add("invalid_answers");
  if (replay.badTimestamps > 0) warnings.add("bad_timestamps");
  if (replay.inconsistentCount > 0) warnings.add("inconsistent");
  if (replay.resumedCount > 0) warnings.add("resumed");
  if (!replay.hasPresentationEvents && assessment.hasResponses) warnings.add("no_presentation_events");
  if (sitting.provenance === "imported") warnings.add("imported");

  const started = (sitting.events ?? []).find((e) => e.type === "session.started");
  const loggedHash = (started?.payload as { releaseHash?: unknown } | undefined)?.releaseHash;
  if (typeof loggedHash === "string" && sitting.releaseHash && loggedHash !== sitting.releaseHash) {
    warnings.add("release_mismatch");
  }

  const received = sitting.receivedAt ? Date.parse(sitting.receivedAt) : NaN;
  if (Number.isFinite(received)) {
    const deviceTimes = [sitting.startedAt, replay.lastActivityAt].map((t) => (t ? Date.parse(t) : NaN));
    if (deviceTimes.some((t) => Number.isFinite(t) && t > received + CLOCK_TOLERANCE_MS)) warnings.add("clock_ahead");
  }

  const backfilled = options.previous?.backfilled ?? options.backfill === true;
  if (backfilled) warnings.add("backfilled");
  if (replay.endedByStaff) warnings.add(endedWarning(replay.endedByStaff.reason));

  const items: ItemEntry[] = [];
  for (const o of assessment.outcomes) {
    const q = release?.byKey.get(o.key);
    const entry: ItemEntry = { k: o.key, o: OUTCOME_CODE.get(o.outcome)! };
    if (o.shown) entry.s = 1;
    if (q && !q.identifying && !q.freeText && o.outcome === "answered") {
      const v = o.value as { kind?: string; code?: unknown; value?: unknown; codes?: unknown } | undefined;
      if (v?.kind === "choice" && typeof v.code === "number") entry.v = v.code;
      else if (v?.kind === "number" && typeof v.value === "number") entry.v = v.value;
      else if (v?.kind === "multi" && Array.isArray(v.codes)) entry.m = (v.codes as unknown[]).filter((c): c is number => typeof c === "number");
    }
    items.push(entry);
  }

  const summary: SessionSummary = {
    sessionId: sitting.sessionId,
    study: sitting.study ?? "",
    studyCode: sitting.studyCode ?? null,
    site: siteOf(sitting.studyCode),
    deviceId: sitting.deviceId ?? null,
    releaseHash: sitting.releaseHash || null,
    releaseKey: sitting.releaseKey ?? null,
    releaseVersion: release?.version ?? null,
    releaseKnown: release !== null,
    provenance: sitting.provenance ?? null,
    quarantined: sitting.quarantined === true,
    unreadable: sitting.unreadable === true,
    terminal: assessment.terminal,
    hasResponses: assessment.hasResponses,
    startedAt: sitting.startedAt ?? replay.firstEventAt ?? null,
    completedAt: sitting.completedAt ?? null,
    lastActivityAt: replay.lastActivityAt ?? null,
    lastResponseAt: replay.lastResponseAt ?? null,
    receivedAt: sitting.receivedAt ?? null,
    firstReceivedAt: options.previous?.firstReceivedAt ?? sitting.receivedAt ?? null,
    backfilled,
    durationMs: replay.durationMs ?? null,
    foregroundMs: replay.foregroundMs ?? null,
    wallClockMs: replay.wallClockMs ?? null,
    resumedCount: replay.resumedCount,
    reviewEdits: replay.reviewEdits,
    backNavigations: replay.backNavigations,
    tooFastCount: replay.tooFastCount,
    inconsistentCount: replay.inconsistentCount,
    eventCount: replay.eventCount,
    counts: assessment.counts,
    requiredCompletion: assessment.requiredCompletion,
    answeredRate: assessment.answeredRate,
    estimated: assessment.estimated,
    estimateReasons: assessment.estimateReasons,
    sections: assessment.sections.map((s) => ({
      key: s.key,
      required: s.required,
      resolved: s.resolved,
      eligible: s.eligible,
      reached: s.reached,
      applicable: s.applicable,
    })),
    missingRequiredKeys: assessment.missingRequiredKeys.slice(0, 300),
    invalidKeys: assessment.invalidKeys.slice(0, 300),
    lastPresentedKey: assessment.lastPresentedKey ?? null,
    finalSectionKey: assessment.finalSectionKey ?? null,
    unknownItemKeys: assessment.unknownItemKeys.slice(0, 50),
    warnings: [...warnings].sort(),
    endedByStaff: replay.endedByStaff ? { reason: replay.endedByStaff.reason, at: replay.endedByStaff.at ?? null } : null,
    items,
    requiredLevels: [...policy.requiredLevels],
    rulesVersion: assessment.rulesVersion,
    summarisedAt: options.now.toISOString(),
  };
  return { summary, assessment, replay };
}

export function outcomeOf(entry: ItemEntry): Outcome {
  return OUTCOMES[entry.o] ?? "undetermined";
}
