import type { Analytics } from "./analytics.js";
import type { Assessment } from "./completeness.js";
import { dayKey } from "./dates.js";
import type { SessionRow } from "./filters.js";
import type { QuestionDef, ReleaseIndex } from "./manifest.js";
import { compareVersions } from "./manifest.js";
import type { QuestionStat } from "./questions.js";
import { REVIEW_STATUS_LABELS } from "./review.js";
import { STATUS_LABELS } from "./status.js";
import { ENDED_REASON_LABELS } from "./summary.js";
import type { CsvValue } from "./csv.js";
import type { ExportSpec } from "./exportSpec.js";

/**
 * Shaping export data as tables. Encoding (CSV, XLSX, PDF) happens in the
 * backend; this decides WHAT goes in, so the rules — identifying answers never,
 * free text and study codes only when permitted and asked for — are unit-tested
 * in one place.
 */

export interface Table {
  name: string;
  headers: string[];
  rows: CsvValue[][];
}

export interface SessionRecord {
  row: SessionRow;
  /**
   * Who the sitting belongs to, from the study dataset: the participant code
   * (or, de-identified, an export-specific label) and the wave. Null where the
   * sitting could not be linked (an incomplete secret code, say).
   */
  participant?: string | null;
  wave?: number | null;
  /** Present when answers are exported. */
  assessment?: Assessment;
  release?: ReleaseIndex;
}

const round = (n: number | null, dp = 1) => (n === null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const pct = (n: number | null) => (n === null ? null : round(n * 100, 1));
const secs = (ms: number | null) => (ms === null ? null : Math.round(ms / 1000));

function when(iso: string | null, spec: ExportSpec, tz: string): string | null {
  if (!iso) return null;
  if (!spec.deidentified) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dayKey(t, tz) : null;
}

const SESSION_HEADERS = [
  "session_id",
  "participant_code",
  "participant_label",
  "wave",
  "study_code",
  "device_id",
  "site",
  "survey",
  "release_version",
  "release_key",
  "release_hash",
  "status",
  "ended_by_researcher",
  "lifecycle",
  "markers",
  "review_status",
  "open_flags",
  "started_at",
  "completed_at",
  "last_activity_at",
  "first_received_at",
  "duration_s",
  "wall_clock_s",
  "resumed_count",
  "required_completion_pct",
  "completion_estimated",
  "required_total",
  "required_answered",
  "required_missing",
  "invalid_answers",
  "not_reached",
  "hidden_by_branching",
  "final_section",
  "last_question_shown",
  "signals",
] as const;

/**
 * What a de-identified export calls each sitting: S00001, S00002… in export
 * order. Never the sitting's own id, which is `ses_<ULID>` and so carries the
 * moment it started to the millisecond — enough to pick a child out of a
 * school's timetable (QC 2026-10-17).
 */
export function exportSessionLabels(records: readonly { row: { summary: { sessionId: string } } }[]): Map<string, string> {
  return new Map(records.map((rec, i) => [rec.row.summary.sessionId, `S${String(i + 1).padStart(5, "0")}`]));
}

/** A session list item as a de-identified export may carry it: its label for its id, days for its times. */
export function deidentifiedListItem<T extends { sessionId: string; startedAt: string | null; lastActivityAt: string | null; completedAt: string | null; receivedAt: string | null; firstReceivedAt: string | null; lastReviewedAt: string | null }>(
  item: T,
  label: string,
  tz: string,
): T {
  const day = (iso: string | null) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? dayKey(t, tz) : null;
  };
  return {
    ...item,
    sessionId: label,
    startedAt: day(item.startedAt),
    lastActivityAt: day(item.lastActivityAt),
    completedAt: day(item.completedAt),
    receivedAt: day(item.receivedAt),
    firstReceivedAt: day(item.firstReceivedAt),
    lastReviewedAt: day(item.lastReviewedAt),
  };
}

function sessionCells(rec: SessionRecord, spec: ExportSpec, tz: string, labels: Map<string, string>): Record<(typeof SESSION_HEADERS)[number], CsvValue> {
  const r = rec.row;
  const s = r.summary;
  return {
    session_id: spec.deidentified ? (labels.get(s.sessionId) ?? null) : s.sessionId,
    participant_code: spec.deidentified ? null : (rec.participant ?? null),
    participant_label: spec.deidentified ? (rec.participant ?? null) : null,
    wave: rec.wave ?? null,
    study_code: spec.includeStudyCode ? s.studyCode : null,
    device_id: spec.deidentified ? null : s.deviceId,
    site: s.site,
    survey: r.survey ?? null,
    release_version: s.releaseVersion,
    release_key: s.releaseKey,
    release_hash: s.releaseHash,
    status: STATUS_LABELS[r.status.display],
    // Why a researcher ended it on the iPad (survey D-70); empty for any other ending.
    ended_by_researcher: s.endedByStaff ? (ENDED_REASON_LABELS[s.endedByStaff.reason] ?? s.endedByStaff.reason) : null,
    lifecycle: r.status.lifecycle,
    markers: r.status.markers.join(";"),
    review_status: REVIEW_STATUS_LABELS[r.review?.status ?? "unreviewed"],
    open_flags: r.status.openFlags,
    started_at: when(s.startedAt, spec, tz),
    completed_at: when(s.completedAt, spec, tz),
    last_activity_at: when(s.lastActivityAt, spec, tz),
    first_received_at: when(s.firstReceivedAt, spec, tz),
    duration_s: secs(s.durationMs),
    wall_clock_s: secs(s.wallClockMs),
    resumed_count: s.resumedCount,
    required_completion_pct: pct(s.requiredCompletion),
    completion_estimated: s.estimated,
    required_total: s.releaseKnown ? s.counts.required : null,
    required_answered: s.releaseKnown ? s.counts.requiredResolved : null,
    required_missing: s.releaseKnown ? s.counts.requiredMissing : null,
    invalid_answers: s.releaseKnown ? s.counts.invalid : null,
    not_reached: s.releaseKnown ? s.counts.notReached : null,
    hidden_by_branching: s.releaseKnown ? s.counts.hiddenBranching : null,
    final_section: s.finalSectionKey,
    last_question_shown: s.lastPresentedKey,
    signals: r.status.signals.join(";"),
  };
}

function includedSessionHeaders(spec: ExportSpec): string[] {
  return SESSION_HEADERS.filter((h) =>
    h === "study_code" ? spec.includeStudyCode : h === "device_id" || h === "participant_code" ? !spec.deidentified : h === "participant_label" ? spec.deidentified : true,
  );
}

/** The value written for an answer: stored codes, never display labels. */
export function answerCell(q: QuestionDef, value: unknown, freeText: boolean): CsvValue {
  if (q.identifying) return null;
  if (q.freeText && !freeText) return null;
  const v = (value ?? null) as Record<string, unknown> | null;
  if (!v) return null;
  switch (v["kind"]) {
    case "choice":
      return typeof v["code"] === "number" ? v["code"] : null;
    case "multi":
      return Array.isArray(v["codes"]) ? (v["codes"] as number[]).join(";") : null;
    case "number":
      return typeof v["value"] === "number" ? v["value"] : null;
    case "text":
      return typeof v["value"] === "string" ? v["value"] : null;
    case "date":
      return typeof v["iso"] === "string" ? (v["iso"] as string).slice(0, 10) : null;
    case "checkboxes":
      return Array.isArray(v["checked"]) ? (v["checked"] as string[]).join(";") : null;
    case "fields":
    case "group_rank":
      return JSON.stringify(v["kind"] === "fields" ? v["values"] : v["assignments"]);
    case "time_grid":
      // One cell: minutes by row code. The wide layout splits it into a column per row (gridCell).
      return typeof v["minutes"] === "object" && v["minutes"] !== null ? JSON.stringify(v["minutes"]) : null;
    default:
      return null;
  }
}

/** One row of a time grid: whole minutes, or null when the row was left empty or not shown. */
export function gridCell(q: QuestionDef, value: unknown, code: number): CsvValue {
  if (q.identifying) return null;
  const v = (value ?? null) as Record<string, unknown> | null;
  if (!v || v["kind"] !== "time_grid" || typeof v["minutes"] !== "object" || v["minutes"] === null) return null;
  const n = (v["minutes"] as Record<string, unknown>)[String(code)];
  return typeof n === "number" ? n : null;
}

/** Question columns across every release in the export, matched by stable id. */
export function unionQuestions(releases: readonly ReleaseIndex[]): QuestionDef[] {
  const newestFirst = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  const seen = new Map<string, QuestionDef>();
  for (const r of newestFirst) for (const q of r.questions) if (!seen.has(q.key) && !q.identifying) seen.set(q.key, q);
  // Newest release's order first, then anything only older releases had.
  return [...seen.values()];
}

export function sessionsTable(records: readonly SessionRecord[], spec: ExportSpec, tz: string): Table {
  const headers = includedSessionHeaders(spec);
  const labels = exportSessionLabels(records);
  if (!spec.includeAnswers) {
    return {
      name: "sessions",
      headers,
      rows: records.map((rec) => {
        const cells = sessionCells(rec, spec, tz, labels);
        return headers.map((h) => cells[h as keyof typeof cells]);
      }),
    };
  }

  const releases = [...new Map(records.filter((r) => r.release).map((r) => [r.release!.hash, r.release!])).values()];
  if (spec.layout === "long") {
    const longHeaders = ["session_id", spec.deidentified ? "participant_label" : "participant_code", "wave", ...(spec.includeStudyCode ? ["study_code"] : []), "survey", "release_version", "question_key", "name", "question_label", "variable", "section", "required", "outcome", "value", "label", "responded_at", "changed", "too_fast"];
    const rows: CsvValue[][] = [];
    for (const rec of records) {
      if (!rec.assessment || !rec.release) continue;
      for (const o of rec.assessment.outcomes) {
        const q = rec.release.byKey.get(o.key)!;
        if (q.identifying) continue;
        const value = o.outcome === "answered" || o.outcome === "invalid" || o.outcome === "answered_hidden" ? answerCell(q, o.value, spec.includeFreeText) : null;
        const code = typeof value === "number" ? value : null;
        rows.push([
          spec.deidentified ? (labels.get(rec.row.summary.sessionId) ?? null) : rec.row.summary.sessionId,
          rec.participant ?? null,
          rec.wave ?? null,
          ...(spec.includeStudyCode ? [rec.row.summary.studyCode] : []),
          rec.row.survey ?? rec.release.survey,
          rec.release.version,
          o.key,
          q.name,
          q.label,
          q.variable,
          q.sectionKey,
          q.required,
          o.outcome,
          value,
          code !== null && q.responseType === "single_choice" ? (q.options?.find((x) => x.code === code)?.label ?? null) : null,
          spec.deidentified ? null : (o.respondedAt ?? null),
          o.changed,
          o.tooFast,
        ]);
      }
    }
    return { name: "answers_long", headers: longHeaders, rows };
  }

  const questions = unionQuestions(releases);
  const used = new Set<string>();
  // Columns carry the codebook's readable names (docs/09); the codebook sheet maps them to the survey's variables.
  const columnName = (q: QuestionDef) => {
    let name = q.name;
    for (let i = 2; used.has(name); i += 1) name = `${q.name}_${i}`;
    used.add(name);
    return name;
  };
  // A time grid is one column per row it could have (minutes), named as the
  // survey names them (`<variable>_<code>`, D-66), then its status.
  const qCols = questions.map((q) => {
    const value = columnName(q);
    const rows = q.responseType === "time_grid" ? (q.options ?? []).map((o) => ({ code: o.code, header: `${value}_${o.code}` })) : null;
    return { q, value, status: `${value}__status`, rows };
  });
  const allHeaders = [...headers, ...qCols.flatMap((c) => (c.rows ? [...c.rows.map((r) => r.header), c.status] : [c.value, c.status]))];
  const rows = records.map((rec) => {
    const cells = sessionCells(rec, spec, tz, labels);
    const base = headers.map((h) => cells[h as keyof typeof cells]);
    const byKey = new Map(rec.assessment?.outcomes.map((o) => [o.key, o]) ?? []);
    const answers = qCols.flatMap(({ q, rows }) => {
      const blank = rows ? rows.map(() => null) : [null];
      if (!rec.release) return [...blank, "unavailable"];
      const own = rec.release.byKey.get(q.key);
      if (!own) return [...blank, "not_in_version"];
      const o = byKey.get(q.key);
      if (!o) return [...blank, null];
      const given = o.outcome === "answered" || o.outcome === "invalid" || o.outcome === "answered_hidden";
      if (rows) return [...rows.map((r) => (given ? gridCell(own, o.value, r.code) : null)), o.outcome];
      return [given ? answerCell(own, o.value, spec.includeFreeText) : null, o.outcome];
    });
    return [...base, ...answers];
  });
  return { name: "answers_wide", headers: allHeaders, rows };
}

/** A dictionary sheet so a wide export can be read without the dashboard. */
export function codebookTable(releases: readonly ReleaseIndex[]): Table {
  const rows: CsvValue[][] = [];
  const ordered = [...releases].sort((a, b) => compareVersions(a.version, b.version));
  for (const r of ordered) {
    for (const q of r.questions) {
      if (q.identifying) continue;
      rows.push([
        r.version,
        q.key,
        q.name,
        q.label,
        q.variable,
        q.legacyVariable ?? null,
        q.revision,
        q.sectionTitle,
        q.text,
        q.responseType,
        q.required,
        q.displayIf ? "yes" : "no",
        q.options?.map((o) => `${o.code}=${o.label}${o.kind !== "substantive" ? ` [${o.kind}]` : ""}`).join(" | ") ?? null,
      ]);
    }
  }
  return {
    name: "codebook",
    headers: ["release_version", "question_key", "name", "label", "variable", "qualtrics_variable", "revision", "section", "question_text", "answer_type", "required", "conditional", "options"],
    rows,
  };
}

export function completenessTables(analytics: Analytics): Table[] {
  const m = analytics.metrics;
  return [
    {
      name: "metrics",
      headers: ["metric", "value"],
      rows: [
        ["sessions_started", m.started],
        ["complete", m.complete],
        ["incomplete", m.incomplete],
        ["abandoned", m.abandoned],
        ["in_progress", m.inProgress],
        ["not_started", m.notStarted],
        ["needs_review", m.needsReview],
        ["invalid", m.invalid],
        ["completion_rate_pct", pct(m.completionRate)],
        ["completion_rate_denominator", m.completionRateDenominator],
        ["reached_end", m.reachedEnd],
        ["reached_end_pct", pct(m.completionRateDenominator > 0 ? m.reachedEnd / m.completionRateDenominator : null)],
        ["quarantined_left_out", m.quarantined],
        ["unreadable_left_out", m.unreadable],
        ["mean_required_completion_pct", pct(m.meanRequiredCompletion)],
        ["median_completion_minutes", m.medianDurationMs === null ? null : round(m.medianDurationMs / 60_000, 1)],
        ["median_completion_n", m.durationN],
        ["estimated_completeness_sessions", m.estimatedCount],
        ["unknown_version_sessions", m.unknownVersionCount],
      ],
    },
    {
      name: "sections",
      headers: ["section_key", "section", "sessions_applicable", "sessions_reached", "sessions_with_missing", "required_answers", "required_answered", "completion_pct"],
      rows: analytics.sections.map((s) => [s.key, s.title, s.sessionsApplicable, s.sessionsReached, s.sessionsWithMissing, s.required, s.resolved, pct(s.completion)]),
    },
    {
      name: "versions",
      headers: ["release_version", "release_key", "release_hash", "sessions", "complete", "incomplete", "abandoned", "completion_rate_pct", "mean_required_completion_pct", "first_started_at", "last_started_at"],
      rows: analytics.versions.map((v) => [v.version ?? "unknown", v.key, v.hash, v.sessions, v.complete, v.incomplete, v.abandoned, pct(v.completionRate), pct(v.meanCompletion), v.firstStartedAt, v.lastStartedAt]),
    },
    {
      name: "most_missed",
      headers: ["question_key", "question", "section", "sessions_missing"],
      rows: analytics.topMissing.map((q) => [q.key, q.text, q.sectionTitle, q.count]),
    },
    {
      name: "drop_off",
      headers: ["question_key", "question", "section", "unfinished_sessions_stopping_here"],
      rows: analytics.dropOff.map((q) => [q.key, q.text, q.sectionTitle, q.count]),
    },
    {
      name: "daily",
      headers: [analytics.granularity === "week" ? "week_starting" : "day", "started", "completed", "completion_rate_pct", "mean_required_completion_pct"],
      rows: analytics.series.map((p) => [p.bucket, p.started, p.completed, pct(p.completionRate), pct(p.meanCompletion)]),
    },
  ];
}

export function questionTable(stats: readonly QuestionStat[], release: ReleaseIndex): Table {
  return {
    name: `questions_${release.version}`,
    headers: [
      "question_key", "name", "label", "variable", "revision", "section", "question", "answer_type", "required", "conditional",
      "sessions", "eligible", "undetermined", "shown", "answered", "declined", "skipped", "no_response",
      "not_reached", "eligible_not_shown", "invalid", "hidden_by_branching", "response_rate_pct", "coverage_pct", "drop_offs", "distribution",
    ],
    rows: stats.map((s) => [
      s.key, s.name, s.label, s.variable, s.revision, s.sectionTitle, s.text, s.responseType, s.required, s.conditional,
      s.sessions, s.eligible, s.undetermined, s.shown, s.answered, s.declined, s.skipped, s.noResponse,
      s.notReached, s.eligibleNotShown, s.invalid, s.hiddenBranching, pct(s.responseRate), pct(s.coverage), s.dropOffs,
      s.distribution.kind === "options"
        ? s.distribution.options.map((o) => `${o.code}=${o.count}`).join(" | ")
        : s.distribution.kind === "numeric"
          ? s.distribution.bins.map((b) => `${b.label}=${b.count}`).join(" | ")
          : null,
    ]),
  };
}
