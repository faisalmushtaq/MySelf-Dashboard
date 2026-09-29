import {
  ESTIMATE_REASON_LABELS,
  FLAG_REASONS,
  OUTCOME_LABELS,
  QUALITY_CONCERNS,
  REVIEW_STATUS_LABELS,
  STATUS_HELP,
  STATUS_LABELS,
  WARNING_LABELS,
  wilson,
  type Analytics,
  type AnswerView,
  type DisplayStatus,
  type FigureResult,
  type ReviewDoc,
  type ReviewStatus,
  type SectionView,
  type SessionListItem,
} from "@myself-dashboard/core";
import { C, formatMinutes, formatWhen, pct, Report, type Cell, type Row, type Tone } from "./report.js";

/**
 * The two formatted reports: a study-level data completeness report (aggregate
 * only) and a single-session report for review. Both are generated on the
 * server; see report.ts for the layout kit.
 */

const STATUS_TONE: Record<DisplayStatus, Tone> = {
  complete: "good",
  incomplete: "warn",
  abandoned: "danger",
  in_progress: "neutral",
  not_started: "muted",
  invalid: "danger",
  test: "muted",
  needs_review: "warn",
};
const REVIEW_TONE: Record<ReviewStatus, Tone> = { reviewed: "good", needs_review: "warn", in_review: "neutral", unreviewed: "muted" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const flagLabel = (id: string) => FLAG_REASONS.find((r) => r.id === id)?.label ?? id;
const concernLabel = (id: string) => QUALITY_CONCERNS.find((r) => r.id === id)?.label ?? id;

// ── data completeness report ─────────────────────────────────────────────

export interface CompletenessReportInput {
  analytics: Analytics;
  /** Figure 1, drawn by the publication renderer; null when there is nothing to plot. */
  figure: FigureResult | null;
  filters: string[];
  dateRange: string;
  generatedBy: string;
  generatedAt: Date;
  timeZone: string;
  rulesVersion: string;
  abandonAfterHours: number;
  requiredLevels: readonly string[];
}

export function completenessPdf(input: CompletenessReportInput): Promise<Buffer> {
  const { analytics: a, timeZone } = input;
  const m = a.metrics;
  const generated = `${formatWhen(input.generatedAt.toISOString(), timeZone)} (${timeZone})`;
  const r = new Report({
    title: "MySelf data completeness report",
    kind: "Data completeness report",
    author: input.generatedBy,
    footer: `Generated ${generated} by ${input.generatedBy}. Aggregate report: counts and rates only, no participant-level data. Completeness rules ${input.rulesVersion}.`,
  });

  r.titleBlock("Data completeness report", `MySelf study  ·  ${input.dateRange}`);
  const versions = a.versions.filter((v) => v.sessions > 0);
  const span = (from: string | null, to: string | null) => {
    if (!from) return null;
    const [f, t] = [formatWhen(from, timeZone, false), formatWhen(to, timeZone, false)];
    return f === t ? f : `${f} to ${t}`;
  };
  r.facts([
    ["Period", input.dateRange],
    ["Filters", input.filters.join("; ") || "None — every session in the period"],
    ["Sessions in this report", `${count(m.started, "session")} across ${count(versions.length, "survey version")}`],
    ["Latest response", m.latestResponseAt ? formatWhen(m.latestResponseAt, timeZone) : "None"],
    ["Generated", `${generated} by ${input.generatedBy}`],
    ["Completeness rules", `${input.rulesVersion}; required levels counted: ${input.requiredLevels.join(", ")}`],
  ]);

  // At a glance.
  r.heading(null, "At a glance", 120);
  const finished = m.completionRateDenominator;
  const ci = m.completionRate !== null ? wilson(Math.round(m.completionRate * finished), finished) : null;
  const share = (n: number) => (m.started > 0 ? `${pct(n / m.started)} of sessions started` : "");
  const dd = a.durationDistribution;
  r.tiles([
    { value: m.started.toLocaleString("en-GB"), label: "Sessions started", note: `${m.newInPeriod.toLocaleString("en-GB")} first received in this period` },
    {
      value: pct(m.completionRate),
      label: "Completion rate",
      note: finished ? `of ${count(finished, "finished session")}${ci ? `; 95% CI ${pct(ci.lo)}–${pct(ci.hi)}` : ""}` : "no finished sessions yet",
      tone: "good",
    },
    { value: pct(m.meanRequiredCompletion), label: "Required answers given", note: "mean across finished sessions" },
    {
      value: m.medianDurationMs === null ? "n/a" : formatMinutes(m.medianDurationMs),
      label: "Median time to complete",
      note: dd ? `IQR ${dd.q1Min.toFixed(1)}–${dd.q3Min.toFixed(1)} min; n = ${dd.n}` : `needs 5 timed sessions (n = ${m.durationN})`,
    },
    { value: m.complete.toLocaleString("en-GB"), label: STATUS_LABELS.complete, note: share(m.complete), tone: "good" },
    { value: m.incomplete.toLocaleString("en-GB"), label: STATUS_LABELS.incomplete, note: share(m.incomplete), tone: "warn" },
    { value: m.abandoned.toLocaleString("en-GB"), label: STATUS_LABELS.abandoned, note: `${share(m.abandoned)}; silent over ${input.abandonAfterHours} h`, tone: "danger" },
    { value: (m.inProgress + m.notStarted).toLocaleString("en-GB"), label: "In progress or not started", note: `${m.inProgress} in progress, ${m.notStarted} not started` },
  ]);

  if (input.figure && m.started > 0) r.figure(input.figure.svg, input.figure.widthPt, input.figure.heightPt, input.figure.legend);

  // 1. Sections.
  r.heading("1", "Completion by section");
  r.paragraph("Required answers given (answered or declined) as a share of the required questions that applied to each participant, after branching. Sections are in questionnaire order.");
  r.table(
    [
      { header: "Section", width: 36 },
      { header: "Applied to", width: 11, align: "right" },
      { header: "Reached", width: 11, align: "right" },
      { header: "With gaps", width: 11, align: "right" },
      { header: "Required answered", width: 31 },
    ],
    a.sections.map(
      (s): Row => ({
        cells: [
          { text: s.title, sub: s.key },
          s.sessionsApplicable,
          s.sessionsReached,
          s.sessionsWithMissing,
          { bar: s.completion, label: s.completion === null ? "n/a" : `${pct(s.completion)}` },
        ],
      }),
    ),
    { empty: "No section applied to the sessions in this report." },
  );

  // 2. Versions.
  r.heading("2", "By survey version");
  r.paragraph("Each session is judged against the version it was collected under. Completion rate is complete ÷ finished (complete, incomplete or abandoned), invalid sessions excluded; whiskers are Wilson 95% intervals.");
  r.table(
    [
      { header: "Version", width: 24 },
      { header: "Sessions", width: 10, align: "right" },
      { header: "Complete", width: 10, align: "right" },
      { header: "Incomplete", width: 11, align: "right" },
      { header: "Abandoned", width: 11, align: "right" },
      { header: "Completion rate", width: 23 },
      { header: "Median", width: 11, align: "right" },
    ],
    versions.map((v): Row => {
      const interval = v.finished > 0 ? wilson(v.finishedComplete, v.finished) : null;
      return {
        cells: [
          { text: v.version ? `v${v.version}` : "Unknown version", sub: [v.key, span(v.firstStartedAt, v.lastStartedAt)].filter(Boolean).join(" · ") },
          v.sessions,
          v.complete,
          v.incomplete,
          v.abandoned,
          { bar: v.completionRate, interval, label: v.completionRate === null ? "n/a" : pct(v.completionRate) },
          formatMinutes(v.medianDurationMs),
        ],
        ...(v.known ? {} : { tone: "warn" as Tone }),
      };
    }),
    { empty: "No sessions." },
  );

  // 3. Sites.
  if (a.sites.length) {
    r.heading("3", "By site");
    r.paragraph("Sites are read from the leading letters of each study code.");
    r.table(
      [
        { header: "Site", width: 22 },
        { header: "Sessions", width: 13, align: "right" },
        { header: "Finished", width: 13, align: "right" },
        { header: "Complete", width: 13, align: "right" },
        { header: "Completion rate", width: 39 },
      ],
      a.sites.map((s): Row => {
        const rate = s.finished > 0 ? s.finishedComplete / s.finished : null;
        return { cells: [{ text: s.site, bold: true }, s.count, s.finished, s.finishedComplete, { bar: rate, interval: s.finished > 0 ? wilson(s.finishedComplete, s.finished) : null }] };
      }),
    );
  }
  const n = (k: number) => String(a.sites.length ? k + 1 : k);

  // 4. Most missed.
  r.heading(n(3), "Required questions most often missing");
  r.paragraph("Counted over sessions where the question applied and was not answered or declined.");
  r.table(
    [
      { header: "#", width: 5, align: "right" },
      { header: "Question", width: 77 },
      { header: "Sessions missing", width: 18, align: "right" },
    ],
    a.topMissing.map((q, i): Row => ({ cells: [i + 1, { text: q.text, sub: `${q.key}  ·  ${q.sectionTitle}` }, { text: String(q.count), bold: true }] })),
    { empty: "No required question is missing from any session in this report." },
  );

  // 5. Drop-off.
  r.heading(n(4), "Where unfinished sessions stopped");
  const unfinished = a.dropOffSections.reduce((s, x) => s + x.count, 0);
  r.paragraph(`The last section and question shown in each of ${count(unfinished, "unfinished session")} (in progress, abandoned, or finished without reaching the end).`);
  if (a.dropOffSections.length) {
    r.subheading("By section");
    r.table(
      [
        { header: "Section", width: 50 },
        { header: "Sessions", width: 14, align: "right" },
        { header: "Share of unfinished", width: 36 },
      ],
      a.dropOffSections.map((s): Row => ({ cells: [s.title, s.count, { bar: unfinished ? s.count / unfinished : null }] })),
    );
  }
  r.subheading("By question");
  r.table(
    [
      { header: "#", width: 5, align: "right" },
      { header: "Last question shown", width: 77 },
      { header: "Sessions", width: 18, align: "right" },
    ],
    a.dropOff.map((q, i): Row => ({ cells: [i + 1, { text: q.text, sub: `${q.key}  ·  ${q.sectionTitle}` }, { text: String(q.count), bold: true }] })),
    { empty: "No unfinished sessions." },
  );

  // 6. Data quality.
  r.heading(n(5), "Data-quality signals");
  r.paragraph("Automatic signals from the session logs, and sessions whose status needs attention. A session can carry more than one.");
  const quality: Row[] = [
    ...a.signals.map((s): Row => ({ cells: [WARNING_LABELS[s.code] ?? s.code, { text: String(s.count), bold: true }] })),
    { cells: [`${STATUS_LABELS.needs_review}: ${STATUS_HELP.needs_review}`, { text: String(m.needsReview), bold: true }] },
    { cells: [`${STATUS_LABELS.invalid}: ${STATUS_HELP.invalid}`, { text: String(m.invalid), bold: true }] },
    { cells: [`${STATUS_LABELS.test}: ${STATUS_HELP.test}`, { text: String(m.test), bold: true }] },
    { cells: ["Completeness estimated (some eligibility could not be determined from the log)", { text: String(m.estimatedCount), bold: true }] },
    { cells: ["Survey version not in the dashboard's registry", { text: String(m.unknownVersionCount), bold: true }], ...(m.unknownVersionCount ? { tone: "warn" as Tone } : {}) },
  ];
  r.table(
    [
      { header: "Signal", width: 84 },
      { header: "Sessions", width: 16, align: "right" },
    ],
    quality,
  );

  // About.
  const about: [string, string][] = [
    ...(["complete", "incomplete", "abandoned", "in_progress", "not_started"] as const).map((s): [string, string] => [
      STATUS_LABELS[s],
      s === "abandoned" || s === "in_progress" ? `${STATUS_HELP[s]} The window is ${input.abandonAfterHours} hours.` : STATUS_HELP[s],
    ]),
    ["Completion rate", "Complete sessions ÷ finished sessions (complete + incomplete + abandoned). Invalid sessions are excluded; test sessions are included only if the filters include them."],
    ["Required answers given", "For each finished session, required questions answered or declined ('prefer not to say' counts as given) ÷ required questions that applied after branching; then averaged."],
    ["Completion time", "Device-measured time from the first to the last answer, for valid sessions. Medians are shown from 5 timed sessions."],
    ["Dates and times", `Shown in ${timeZone}.`],
  ];
  r.heading(null, "About this report", r.definitionsHeight(about) + 30);
  r.definitions(about);
  r.paragraph("This report holds aggregates only. Small counts can still point to individuals in a small study — share it only within the research team.", { italic: true, color: C.muted, after: 0 });
  if (r.lost.size) r.paragraph("Some characters in question wording could not be drawn in this PDF and are shown as '?'. The CSV and Excel versions hold the exact text.", { italic: true, color: C.muted });

  return r.finish();
}

// ── session report ───────────────────────────────────────────────────────

export interface SessionReportInput {
  item: SessionListItem;
  releaseLabel: string;
  sections: SectionView[] | null;
  review: ReviewDoc;
  notes: { text: string; authorEmail: string | null; createdAt: string | null }[];
  warnings: string[];
  estimateReasons: string[];
  /** The participant as the survey links them, when the report carries identifiers. */
  participant: { code: string; wave: number; sittings: { sessionId: string; wave: number; startedAt: string; complete: boolean }[] } | null;
  generatedBy: string;
  generatedAt: Date;
  timeZone: string;
  includeStudyCode: boolean;
  includeFreeText: boolean;
  retentionHours: number;
}

function answerStatus(a: AnswerView): { tag: string; tone: Tone; row?: Tone } {
  const required = a.countsAsRequired;
  switch (a.outcome) {
    case "answered":
      return { tag: "Answered", tone: "good" };
    case "declined":
      return { tag: "Declined", tone: "neutral" };
    case "invalid":
      return { tag: "Invalid", tone: "danger", row: "danger" };
    case "skipped":
    case "no_response":
    case "not_reached":
    case "eligible_not_shown":
      return required && a.missing ? { tag: `Missing · ${OUTCOME_LABELS[a.outcome].toLowerCase()}`, tone: "danger", row: "danger" } : { tag: OUTCOME_LABELS[a.outcome], tone: "muted" };
    case "answered_hidden":
      return { tag: "Answered, then hidden", tone: "neutral" };
    default:
      return { tag: OUTCOME_LABELS[a.outcome], tone: "muted" };
  }
}

function answerCell(a: AnswerView, includeFreeText: boolean): Cell {
  if (a.answer.redacted === "identifying") return { text: "Withheld — identifying", italic: true, color: C.muted };
  if (a.answer.redacted === "free_text" || (a.freeText && !includeFreeText && a.answer.display)) return { text: "Withheld — free text", italic: true, color: C.muted };
  if (a.answer.display === null) return { text: "–", color: C.muted };
  const notes = [a.invalidReason, a.tooFast ? "answered faster than it could be read" : null, a.inconsistent ? "flagged as inconsistent by the survey" : null, a.changed ? "changed before submitting" : null].filter(Boolean);
  const c = a.answer.code;
  const code = c === null || c === undefined || String(c) === a.answer.display ? null : Array.isArray(c) ? (c.length ? `codes ${c.join(", ")}` : null) : `code ${c}`;
  const sub = [code, ...notes].filter(Boolean).join(" · ");
  return { text: a.answer.display, ...(sub ? { sub } : {}) };
}

function sectionState(s: SectionView): { tag: string; tone: Tone } {
  if (!s.applicable) return { tag: "Not applicable", tone: "muted" };
  if (!s.reached) return { tag: "Not reached", tone: "danger" };
  if (s.completion === null || s.completion >= 1) return { tag: "Complete", tone: "good" };
  return { tag: "Gaps", tone: "warn" };
}

export function sessionReportPdf(input: SessionReportInput): Promise<Buffer> {
  const { item, review, timeZone } = input;
  const generated = `${formatWhen(input.generatedAt.toISOString(), timeZone)} (${timeZone})`;
  const r = new Report({
    title: `MySelf session report ${item.sessionId}`,
    kind: "Session report",
    author: input.generatedBy,
    footer: `Session ${item.sessionId}. Generated ${generated} by ${input.generatedBy}. Participant-level research data: store and delete it under the study's data management plan. The server copy is deleted after ${input.retentionHours} hours.`,
  });
  const d = r.doc;

  r.titleBlock(
    "Session report",
    input.participant ? `Participant ${input.participant.code}  ·  wave ${input.participant.wave}  ·  session ${item.sessionId}` : `Session ${item.sessionId}`,
  );

  // Status line: display status, review state, and whether completeness is estimated.
  r.ensure(40);
  let x = 48;
  const y = d.y;
  x += r.tag(x, y, STATUS_LABELS[item.status.display], STATUS_TONE[item.status.display], 8.2) + 6;
  if (item.status.display !== item.status.lifecycle) x += r.tag(x, y, STATUS_LABELS[item.status.lifecycle], STATUS_TONE[item.status.lifecycle], 8.2) + 6;
  x += r.tag(x, y, `Review: ${REVIEW_STATUS_LABELS[review.status]}`, REVIEW_TONE[review.status], 8.2) + 6;
  if (item.estimated) r.tag(x, y, "Completeness estimated", "neutral", 8.2);
  d.y = y + 22;

  // Completion bar.
  if (item.requiredTotal !== null && item.requiredCompletion !== null) {
    const missing = item.requiredMissing ?? 0;
    d.font("Helvetica-Bold").fontSize(10).fillColor(C.ink).text(`${item.estimated ? "~" : ""}${pct(item.requiredCompletion)} of required answers given`, 48, d.y, { continued: true });
    d.font("Helvetica").fontSize(9).fillColor(C.secondary).text(missing ? `   ${count(missing, "required question")} missing of ${item.requiredTotal}` : `   all ${item.requiredTotal} required questions answered or declined`);
    r.bar(48, d.y + 4, 499.28, item.requiredCompletion, null, 7);
    d.y += 20;
  } else {
    r.paragraph("Completeness cannot be judged: this session's survey version is not in the dashboard's registry.", { italic: true });
  }

  const finalSection = input.sections?.find((s) => s.key === item.finalSectionKey)?.title ?? item.finalSectionKey;
  r.facts(
    [
      ...(input.participant
        ? ([
            ["Participant code", input.participant.code],
            ["Wave", String(input.participant.wave)],
          ] as [string, string][])
        : []),
      ...(input.includeStudyCode && item.studyCode ? ([["Study code", item.studyCode]] as [string, string][]) : []),
      ["Site", item.site ?? "–"],
      ["Survey version", input.releaseLabel],
      ["Started", formatWhen(item.startedAt, timeZone)],
      ["Completed", item.completedAt ? formatWhen(item.completedAt, timeZone) : "Not completed"],
      ["Last activity", formatWhen(item.lastActivityAt, timeZone)],
      ["Time taken", item.durationMs !== null ? `${formatMinutes(item.durationMs)} (device-measured)` : "–"],
      ["Last section reached", finalSection ?? "–"],
      ["Received by the study", `${formatWhen(item.firstReceivedAt, timeZone)}${item.provenance === "imported" ? " (imported from a handover file)" : ""}`],
      ["Session id", item.sessionId],
    ],
    3,
  );

  const openFlags = review.flags.filter((f) => f.open);
  r.callout(
    "danger",
    `${count(openFlags.length, "open review flag")}`,
    openFlags.map((f) => `${flagLabel(f.reason)}${f.note ? ` — ${f.note}` : ""} (${f.createdByEmail ?? "a researcher"}, ${formatWhen(f.createdAt, timeZone, false)})`),
  );
  r.callout("warn", "Data-quality signals", input.warnings.map((w) => WARNING_LABELS[w] ?? w));
  if (input.estimateReasons.length) {
    r.callout("neutral", "Completeness is estimated", input.estimateReasons.map((e) => `Because ${ESTIMATE_REASON_LABELS[e] ?? e}.`));
  }

  if (!input.sections) {
    r.heading("1", "Answers");
    r.paragraph("This session's survey version is not in the dashboard's registry, so its answers cannot be shown against their questions. Register the version and export the report again.", { italic: true });
  } else {
    // 1. Section overview.
    r.heading("1", "Sections at a glance", 80);
    r.table(
      [
        { header: "Section", width: 42 },
        { header: "Required answered", width: 32 },
        { header: "Missing", width: 10, align: "right" },
        { header: "State", width: 16 },
      ],
      input.sections.map((s): Row => {
        const state = sectionState(s);
        return {
          cells: [
            { text: s.title, ...(s.conditional ? { sub: "asked only to some participants" } : {}) },
            s.applicable ? { bar: s.completion, label: s.required ? `${s.resolved}/${s.required}` : "none" } : { text: "–", color: C.muted },
            s.applicable ? s.required - s.resolved : null,
            { tag: state.tag, tone: state.tone },
          ],
        };
      }),
    );

    // 2. Answers, section by section.
    r.heading("2", "Answers", 90);
    r.paragraph(
      `In the wording of the version this participant received. Missing required answers are highlighted. Identifying answers are never included${input.includeFreeText ? "" : "; free-text answers are withheld from this report"}.`,
    );
    input.sections.forEach((s, i) => {
      const state = sectionState(s);
      if (!s.applicable || !s.reached) {
        r.subheading(`2.${i + 1}  ${s.title}`, `${state.tag} — ${count(s.answers.length, "question")}${s.applicable && s.required ? `, ${s.required} required` : ""}`);
        r.space(2);
        return;
      }
      r.subheading(`2.${i + 1}  ${s.title}`, s.required ? `${s.resolved} of ${s.required} required answered` : "no required questions");
      r.table(
        [
          { header: "Question", width: 50 },
          { header: "Answer", width: 30 },
          { header: "Status", width: 20 },
        ],
        s.answers.map((a): Row => {
          const st = answerStatus(a);
          return {
            cells: [
              { text: a.text, sub: `${a.variable}${a.countsAsRequired ? "  ·  required" : ""}${a.conditional ? "  ·  conditional" : ""}` },
              answerCell(a, input.includeFreeText),
              { tag: st.tag, tone: st.tone },
            ],
            ...(st.row ? { tone: st.row } : {}),
          };
        }),
      );
    });
  }

  // 3. Review.
  r.heading("3", "Researcher review", 80);
  r.paragraph("Kept apart from the participant's answers, which a review never changes.");
  r.facts(
    [
      ["Review status", REVIEW_STATUS_LABELS[review.status]],
      ["Last reviewed", review.lastReviewedAt ? `${formatWhen(review.lastReviewedAt, timeZone)}` : "Never"],
      ["Marked", [review.markedTest ? "test session" : null, review.markedInvalid ? "invalid" : null].filter(Boolean).join(", ") || "–"],
      ["Quality concerns", review.qualityConcerns.map(concernLabel).join("; ") || "None recorded"],
    ],
    2,
  );
  if (review.flags.length) {
    r.subheading("Flags");
    r.table(
      [
        { header: "Reason", width: 30 },
        { header: "Note", width: 38 },
        { header: "Raised", width: 18 },
        { header: "State", width: 14 },
      ],
      review.flags.map(
        (f): Row => ({
          cells: [
            flagLabel(f.reason),
            f.note ?? { text: "–", color: C.muted },
            { text: formatWhen(f.createdAt, timeZone, false), sub: f.createdByEmail ?? undefined },
            f.open ? { tag: "Open", tone: "danger" } : { tag: "Resolved", tone: "good", sub: f.resolvedAt ? formatWhen(f.resolvedAt, timeZone, false) : "" },
          ],
        }),
      ),
    );
  }
  r.subheading("Notes");
  r.table(
    [
      { header: "Written", width: 22 },
      { header: "Note", width: 78 },
    ],
    input.notes.map((note): Row => ({ cells: [{ text: formatWhen(note.createdAt, timeZone), sub: note.authorEmail ?? undefined }, note.text] })),
    { empty: "No notes." },
  );

  // 4. The participant's other sittings.
  if (input.participant && input.participant.sittings.length > 1) {
    r.heading("4", "This participant's sittings", 60);
    r.paragraph(`Linked by participant code ${input.participant.code}, exactly as the survey's own export links them.`);
    r.table(
      [
        { header: "Wave", width: 10, align: "right" },
        { header: "Started", width: 30 },
        { header: "Session", width: 42 },
        { header: "Finished", width: 18 },
      ],
      input.participant.sittings.map(
        (s): Row => ({
          cells: [s.wave, formatWhen(s.startedAt, timeZone), { text: s.sessionId, bold: s.sessionId === item.sessionId, ...(s.sessionId === item.sessionId ? { sub: "this report" } : {}) }, s.complete ? "Yes" : "No"],
          ...(s.sessionId === item.sessionId ? { tone: "good" as Tone } : {}),
        }),
      ),
    );
  }

  // Key.
  const key: [string, string][] = [
    [STATUS_LABELS[item.status.lifecycle], STATUS_HELP[item.status.lifecycle]],
    ["Missing", "A required question that applied to this participant and was skipped, shown without a response, or never reached."],
    ["Declined", "The participant chose 'prefer not to say'. It counts as a given answer."],
    ["Not shown (branching)", "The survey's branching did not ask this question of this participant; it does not count as missing."],
    ["Times", `Shown in ${timeZone}. Device times depend on the device clock.`],
  ];
  r.heading(null, "Key", r.definitionsHeight(key));
  r.definitions(key);
  if (r.lost.size) r.paragraph("Some characters could not be drawn in this PDF and are shown as '?'. The data exports hold the exact text.", { italic: true, color: C.muted });

  return r.finish();
}
