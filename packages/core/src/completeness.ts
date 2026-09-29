import type { ReleaseIndex, RequiredLevel } from "./manifest.js";
import type { ReplayResult } from "./replay.js";
import { validateAnswer } from "./validate.js";
import { AnswerStore, evaluate, type AnswerValue, type LogicExpr } from "./vendor/engine.js";

/**
 * Completeness, as defined in docs/03-completeness.md. Rule set `completeness@1`.
 *
 * Every question in the sitting's OWN release gets exactly one outcome. The
 * difference between "not answered", "hidden by valid branching", "never reached"
 * and "cannot know" is the whole point: counting fields in a document would call a
 * participant without a smartphone 40% incomplete for not answering questions about
 * their social media.
 */
export const RULES_VERSION = "completeness@1";

export const OUTCOMES = [
  "answered",
  "declined",
  "invalid",
  "skipped",
  "no_response",
  "not_reached",
  "eligible_not_shown",
  "hidden_branching",
  "answered_hidden",
  "undetermined",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

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

/** Outcomes that count as a missing answer to a required question. */
export const MISSING: ReadonlySet<Outcome> = new Set(["invalid", "skipped", "no_response", "not_reached", "eligible_not_shown"]);
/** Outcomes that satisfy a required question. */
export const RESOLVED: ReadonlySet<Outcome> = new Set(["answered", "declined"]);
/** Outcomes removed from every denominator. */
export const EXCLUDED: ReadonlySet<Outcome> = new Set(["hidden_branching", "answered_hidden", "undetermined"]);

export type Eligibility = "yes" | "no" | "unknown";

export interface QuestionOutcome {
  key: string;
  outcome: Outcome;
  eligibility: Eligibility;
  shown: boolean;
  presentedCount: number;
  /** Counts as required under the policy (independent of eligibility). */
  requiredLevel: boolean;
  missing: boolean;
  resolved: boolean;
  /** An answer the definition allows to be empty, and it is. */
  emptyValue: boolean;
  invalidReason?: string;
  /** Raw value. Server-side only; identifying and free-text values never leave it. */
  value?: unknown;
  respondedAt?: string;
  changed: boolean;
  tooFast: boolean;
  inconsistent: boolean;
  dwellMs?: number;
}

export interface SectionResult {
  key: string;
  title: string;
  required: number;
  resolved: number;
  eligible: number;
  answered: number;
  reached: boolean;
  /** False when no question in the section applied (e.g. a skipped-by-logic section). */
  applicable: boolean;
  completion: number | null;
}

export interface Counts {
  questions: number;
  eligible: number;
  shown: number;
  answered: number;
  declined: number;
  invalid: number;
  skipped: number;
  noResponse: number;
  notReached: number;
  eligibleNotShown: number;
  hiddenBranching: number;
  answeredHidden: number;
  undetermined: number;
  required: number;
  requiredResolved: number;
  requiredMissing: number;
  requiredUndetermined: number;
}

export interface Assessment {
  rulesVersion: string;
  releaseKnown: boolean;
  terminal: boolean;
  hasResponses: boolean;
  outcomes: QuestionOutcome[];
  counts: Counts;
  /** 0..1, or null when not applicable / unavailable. */
  requiredCompletion: number | null;
  answeredRate: number | null;
  estimated: boolean;
  estimateReasons: string[];
  sections: SectionResult[];
  missingRequiredKeys: string[];
  invalidKeys: string[];
  /** Last question shown (the drop-off point for an unfinished sitting). */
  lastPresentedKey?: string;
  /** Section of the last presentable unit shown. */
  finalSectionKey?: string;
  /** Item keys in the log that this release does not define. */
  unknownItemKeys: string[];
}

const emptyCounts = (): Counts => ({
  questions: 0,
  eligible: 0,
  shown: 0,
  answered: 0,
  declined: 0,
  invalid: 0,
  skipped: 0,
  noResponse: 0,
  notReached: 0,
  eligibleNotShown: 0,
  hiddenBranching: 0,
  answeredHidden: 0,
  undetermined: 0,
  required: 0,
  requiredResolved: 0,
  requiredMissing: 0,
  requiredUndetermined: 0,
});

/**
 * Three-valued (Kleene) evaluation of a display condition.
 *
 * A leaf that reads a question whose final state is not yet known — the sitting
 * has not finished and that question has no response — is `unknown`. Everything
 * else is decided by the survey's own `evaluate()` on that leaf, so a known answer
 * is judged exactly as the device judged it. `all`/`any`/`not` combine with the
 * usual short-circuits: `any(true, unknown)` is true, `all(false, unknown)` is false.
 */
function evaluate3(expr: LogicExpr, store: AnswerStore, unknownKeys: ReadonlySet<string>, asOf: Date | undefined): Eligibility {
  switch (expr.op) {
    case "all": {
      let sawUnknown = false;
      for (const a of expr.args) {
        const r = evaluate3(a, store, unknownKeys, asOf);
        if (r === "no") return "no";
        if (r === "unknown") sawUnknown = true;
      }
      return sawUnknown ? "unknown" : "yes";
    }
    case "any": {
      let sawUnknown = false;
      for (const a of expr.args) {
        const r = evaluate3(a, store, unknownKeys, asOf);
        if (r === "yes") return "yes";
        if (r === "unknown") sawUnknown = true;
      }
      return sawUnknown ? "unknown" : "no";
    }
    case "not": {
      const r = evaluate3(expr.arg, store, unknownKeys, asOf);
      return r === "unknown" ? "unknown" : r === "yes" ? "no" : "yes";
    }
    default: {
      const key = `${expr.target.item.instrument}.${expr.target.item.item}`;
      if (unknownKeys.has(key)) return "unknown";
      return evaluate(expr, store, asOf) ? "yes" : "no";
    }
  }
}

export interface AssessOptions {
  requiredLevels: readonly RequiredLevel[];
  /**
   * When the sitting started (ISO). Age conditions are judged on this day, as the
   * device judged them (D-51); without it they are false, as on the device.
   */
  sittingStart?: string | null;
}

/**
 * Assess one sitting against its own release.
 *
 * `release` is null when the sitting's version is not in the registry; the result
 * then says so (`releaseKnown: false`, completeness null) rather than guessing.
 */
export function assessSitting(replay: ReplayResult, release: ReleaseIndex | null, options: AssessOptions): Assessment {
  const hasResponses = [...replay.items.values()].some((f) => f.response !== null);
  if (!release) {
    return {
      rulesVersion: RULES_VERSION,
      releaseKnown: false,
      terminal: replay.terminal,
      hasResponses,
      outcomes: [],
      counts: emptyCounts(),
      requiredCompletion: null,
      answeredRate: null,
      estimated: false,
      estimateReasons: [],
      sections: [],
      missingRequiredKeys: [],
      invalidKeys: [],
      unknownItemKeys: [],
    };
  }

  // The answer state the device's walker would see: answered items with their
  // values, skips and declines as statuses.
  const started = options.sittingStart ? new Date(options.sittingStart) : undefined;
  const asOf = started && !Number.isNaN(started.getTime()) ? started : undefined;
  const store = new AnswerStore();
  for (const f of replay.items.values()) {
    if (!f.response) continue;
    const [instrument = "", item = ""] = f.key.split(".");
    const ref = { instrument, item, revision: 1 };
    if (f.response === "answered") store.set(ref, { status: "answered", value: f.value as AnswerValue });
    else store.set(ref, { status: f.response });
  }

  // Questions whose final state is still open: the sitting has not finished and
  // they have no response. A condition reading one of these cannot be decided.
  const unknownKeys = new Set<string>();
  if (!replay.terminal) {
    for (const q of release.questions) {
      if (!replay.items.get(q.key)?.response) unknownKeys.add(q.key);
    }
  }

  const required = new Set(options.requiredLevels);
  const outcomes: QuestionOutcome[] = [];
  const counts = emptyCounts();
  const missingRequiredKeys: string[] = [];
  const invalidKeys: string[] = [];
  const estimateReasons = new Set<string>();
  if (!replay.hasPresentationEvents && hasResponses) estimateReasons.add("no_presentation_events");

  for (const q of release.questions) {
    const f = replay.items.get(q.key);
    const eligibility: Eligibility = q.displayIf ? evaluate3(q.displayIf, store, unknownKeys, asOf) : "yes";
    const presentedCount = f?.presentedCount ?? 0;
    const shown = presentedCount > 0 || (!replay.hasPresentationEvents && (f?.response ?? null) !== null);
    let outcome: Outcome;
    let emptyValue = false;
    let invalidReason: string | undefined;

    if (f?.response === "answered") {
      if (eligibility === "no") outcome = "answered_hidden";
      else {
        const check = validateAnswer(q, f.value);
        if (check.valid) {
          outcome = "answered";
          emptyValue = check.empty;
        } else {
          outcome = "invalid";
          invalidReason = check.reason;
        }
      }
    } else if (f?.response === "declined") {
      outcome = eligibility === "no" ? "answered_hidden" : "declined";
    } else if (f?.response === "skipped") {
      outcome = eligibility === "no" ? "hidden_branching" : "skipped";
    } else if (shown) {
      // Seen, so it applied at the time; if a later change hid it, it no longer counts.
      outcome = eligibility === "no" ? "hidden_branching" : "no_response";
    } else if (eligibility === "no") {
      outcome = "hidden_branching";
    } else if (eligibility === "unknown") {
      outcome = "undetermined";
    } else {
      outcome = replay.terminal ? "eligible_not_shown" : "not_reached";
    }

    const requiredLevel = required.has(q.required);
    const missing = requiredLevel && MISSING.has(outcome);
    const resolved = RESOLVED.has(outcome);
    outcomes.push({
      key: q.key,
      outcome,
      // Seen or answered means it applied at the time, even if the condition now
      // reads a question that is still open.
      eligibility: eligibility === "unknown" && (shown || f?.response) ? "yes" : eligibility,
      shown,
      presentedCount,
      requiredLevel,
      missing,
      resolved,
      emptyValue,
      ...(invalidReason ? { invalidReason } : {}),
      ...(f && f.response === "answered" ? { value: f.value } : {}),
      ...(f?.respondedAt ? { respondedAt: f.respondedAt } : {}),
      changed: f?.changed ?? false,
      tooFast: f?.tooFast ?? false,
      inconsistent: f?.inconsistent ?? false,
      ...(f?.dwellMs !== undefined ? { dwellMs: f.dwellMs } : {}),
    });

    counts.questions += 1;
    if (shown) counts.shown += 1;
    if (!EXCLUDED.has(outcome)) counts.eligible += 1;
    switch (outcome) {
      case "answered": counts.answered += 1; break;
      case "declined": counts.declined += 1; break;
      case "invalid": counts.invalid += 1; invalidKeys.push(q.key); break;
      case "skipped": counts.skipped += 1; break;
      case "no_response": counts.noResponse += 1; break;
      case "not_reached": counts.notReached += 1; break;
      case "eligible_not_shown": counts.eligibleNotShown += 1; break;
      case "hidden_branching": counts.hiddenBranching += 1; break;
      case "answered_hidden": counts.answeredHidden += 1; break;
      case "undetermined": counts.undetermined += 1; break;
    }
    if (requiredLevel) {
      if (outcome === "undetermined") {
        counts.requiredUndetermined += 1;
        estimateReasons.add("undetermined_eligibility");
      } else if (!EXCLUDED.has(outcome)) {
        counts.required += 1;
        if (resolved) counts.requiredResolved += 1;
        if (missing) {
          counts.requiredMissing += 1;
          missingRequiredKeys.push(q.key);
        }
      }
    }
  }

  const byKey = new Map(outcomes.map((o) => [o.key, o]));
  const sections: SectionResult[] = release.sections.map((s) => {
    let req = 0;
    let res = 0;
    let eligible = 0;
    let answered = 0;
    let reached = false;
    for (const key of s.questionKeys) {
      const o = byKey.get(key)!;
      if (o.shown || o.resolved || o.outcome === "skipped") reached = true;
      if (!EXCLUDED.has(o.outcome)) eligible += 1;
      if (o.outcome === "answered") answered += 1;
      if (o.requiredLevel && !EXCLUDED.has(o.outcome)) {
        req += 1;
        if (o.resolved) res += 1;
      }
    }
    return {
      key: s.key,
      title: s.title,
      required: req,
      resolved: res,
      eligible,
      answered,
      reached,
      applicable: eligible > 0,
      completion: req > 0 ? res / req : null,
    };
  });

  // Drop-off: the last question shown, in presentation order of the log.
  let lastPresentedKey: string | undefined;
  let lastSeq = -1;
  let finalSectionKey: string | undefined;
  let finalSeq = -1;
  for (const f of replay.items.values()) {
    if (f.lastPresentedSeq === undefined) continue;
    if (release.byKey.has(f.key) && f.lastPresentedSeq > lastSeq) {
      lastSeq = f.lastPresentedSeq;
      lastPresentedKey = f.key;
    }
    if (release.unitSection.has(f.key) && f.lastPresentedSeq > finalSeq) {
      finalSeq = f.lastPresentedSeq;
      finalSectionKey = release.unitSection.get(f.key);
    }
  }
  if (!replay.hasPresentationEvents) {
    // Legacy logs: the furthest question with a response stands in.
    let best = -1;
    for (const f of replay.items.values()) {
      const order = release.unitOrder.get(f.key);
      if (f.response && order !== undefined && order > best) {
        best = order;
        if (release.byKey.has(f.key)) lastPresentedKey = f.key;
        finalSectionKey = release.unitSection.get(f.key);
      }
    }
  }

  const unknownItemKeys = [...replay.items.keys()].filter(
    (k) => !release.unitKeys.has(k) && !k.includes(".__"),
  );

  return {
    rulesVersion: RULES_VERSION,
    releaseKnown: true,
    terminal: replay.terminal,
    hasResponses,
    outcomes,
    counts,
    requiredCompletion: counts.required > 0 ? counts.requiredResolved / counts.required : null,
    answeredRate: counts.eligible > 0 ? counts.answered / counts.eligible : null,
    estimated: estimateReasons.size > 0,
    estimateReasons: [...estimateReasons],
    sections,
    missingRequiredKeys,
    invalidKeys,
    ...(lastPresentedKey ? { lastPresentedKey } : {}),
    ...(finalSectionKey ? { finalSectionKey } : {}),
    unknownItemKeys,
  };
}

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
