import type { Assessment, Outcome } from "./vendor/myself/store/completeness.js";

/**
 * Completeness, as defined in docs/03-completeness.md. Rule set `completeness@2`.
 *
 * THE RULES ARE THE SURVEY'S, vendored: `vendor/myself/store/completeness.ts` is a
 * verbatim copy of the survey's `packages/store/src/completeness.ts`, and the survey's
 * researcher view counts "all required answered" with those same lines. So a sitting
 * this dashboard calls complete is one the researcher view counts as all required
 * answered, and the two cannot drift: `scripts/check-vendored.mjs` fails CI when the
 * copy differs. What stays here is what only the dashboard needs — the words shown
 * beside each outcome, and navigation between missing answers.
 *
 * Every question in the sitting's OWN release gets exactly one outcome. The
 * difference between "not answered", "hidden by valid branching", "never reached"
 * and "cannot know" is the whole point: counting fields in a document would call a
 * participant without a smartphone 40% incomplete for not answering questions about
 * their social media.
 */
export {
  assessSitting,
  EXCLUDED,
  MISSING,
  OUTCOMES,
  RESOLVED,
  RULES_VERSION,
  type AssessOptions,
  type Assessment,
  type Counts,
  type Eligibility,
  type Outcome,
  type QuestionOutcome,
  type SectionResult,
} from "./vendor/myself/store/completeness.js";

/** Cross-version states: never produced for a question in the sitting's own version. */
export type CrossVersionOutcome = "not_in_version" | "unavailable";

export const OUTCOME_LABELS: Record<Outcome | CrossVersionOutcome, string> = {
  answered: "Answered",
  declined: "Declined (prefer not to say)",
  invalid: "Invalid answer",
  skipped: "Skipped",
  no_response: "Shown, no response",
  not_reached: "Not reached",
  eligible_not_shown: "Eligible, never shown",
  hidden_branching: "Not shown (branching)",
  answered_hidden: "Answered, later hidden by branching",
  undetermined: "Eligibility unknown",
  not_in_version: "Not in this version",
  unavailable: "Version unknown",
};

export const OUTCOME_HELP: Record<Outcome | CrossVersionOutcome, string> = {
  answered: "A valid answer is recorded. A legitimately empty answer that the question allows also counts.",
  declined: "The participant used the explicit prefer-not-to-say control. Counts as a response.",
  invalid: "A value is recorded but does not fit this version's definition of the question, or is corrupted.",
  skipped: "The participant saw the question and chose to leave it blank.",
  no_response: "The question was shown but left without an answer or a skip (e.g. moved back, app closed).",
  not_reached: "The question applied to this participant but the sitting ended before it.",
  eligible_not_shown: "The sitting finished, and under the final answers this question applied, but it was never shown — usually because an earlier answer was changed from the review screen.",
  hidden_branching: "The survey's skip logic did not show this question to this participant. Not missing.",
  answered_hidden: "Answered, then an earlier answer changed so the question no longer applies. Kept, not counted.",
  undetermined: "Whether this question applied depends on a question the participant never reached.",
  not_in_version: "The question does not exist in the survey version this sitting used. Never collected.",
  unavailable: "The sitting's survey version is not in the registry, so its questions cannot be interpreted.",
};

export const ESTIMATE_REASON_LABELS: Record<string, string> = {
  undetermined_eligibility: "some questions depend on answers the participant never reached",
  no_presentation_events: "this log records no question presentations, so shown/not-shown is inferred",
};

/** The first question a researcher should look at: the next missing required answer after `afterKey`. */
export function nextMissingRequired(assessment: Assessment, afterKey?: string): string | undefined {
  const keys = assessment.missingRequiredKeys;
  if (keys.length === 0) return undefined;
  if (!afterKey) return keys[0];
  const order = assessment.outcomes.map((o) => o.key);
  const pos = order.indexOf(afterKey);
  return keys.find((k) => order.indexOf(k) > pos) ?? keys[0];
}
