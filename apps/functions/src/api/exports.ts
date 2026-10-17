import {
  authoriseExport,
  buildSummary,
  codebookTable,
  completenessTables,
  computeAnalytics,
  computeQuestionStats,
  can,
  compareRows,
  decideStudyAccess,
  exportSurvey,
  buildSchoolReportView,
  compareVersions,
  composeFigure,
  DEFAULT_FIGURE,
  RULES_VERSION,
  DATE_PRESET_LABELS,
  describeFilters,
  EXPORT_KIND_LABELS,
  EXPORT_SCOPE_LABELS,
  exportFileName,
  ExportSpecError,
  isSensitive,
  makePredicate,
  deidentifiedListItem,
  exportSessionLabels,
  parseExportSpec,
  poolingCompatibility,
  presentAnswers,
  questionTable,
  rangeFor,
  sessionsTable,
  toListItem,
  unionQuestions,
  type ExportJobView,
  type ExportPreview,
  type ExportSpec,
  type ReleaseIndex,
  type ReviewDoc,
  type SessionRecord,
  type SessionRow,
  type Table,
} from "@myself-dashboard/core";
import { buildDashboardBids } from "@myself-dashboard/core/survey";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { actorFields, audit } from "../audit.js";
import { accountFacts, decideAccess, requireStudyActor, tokenFacts, type StudyActor } from "../authz.js";
import { ALLOWED_ORIGINS, auth, bucket, dash, DEFAULT_STUDY, EXPORT_PREFIX } from "../env.js";
import { dpaths } from "../paths.js";
import { allReleaseIndexes, releaseIndex, releaseList } from "../releases.js";
import { loadStudyDataset, participantsFor, readNarratives, sha256, surveyManifests } from "../studyData.js";
import { scoredSessions, studyGroupSettings } from "../scoring.js";
import { accessPolicy, studyAccessList, studyPolicy } from "../settings.js";
import { readSittings } from "../sittings.js";
import { currentRows } from "../store.js";
import { lookupStudy, registeredStudies, studySurveys } from "../studies.js";
import { callableOptions } from "./common.js";
import { csvOf, stackedCsvOf, xlsxOf } from "../exporters/encode.js";
import { completenessPdf, sessionReportPdf } from "../exporters/pdf.js";
import { schoolReportPdf } from "../exporters/schoolReport.js";

/**
 * Exports: previewed, confirmed, generated on the server, stored privately,
 * downloaded through an authenticated endpoint, audited, and deleted after the
 * retention period (docs/02 §2.5). The browser never holds more than the file the
 * researcher asked for, and never builds one.
 *
 * An export is of one study, the one its creator is working in, and is filed
 * in that study's `exportJobs` (docs/12 §12.9).
 */

type Actor = StudyActor;

function parseSpec(raw: unknown): ExportSpec {
  try {
    return parseExportSpec(raw);
  } catch (error) {
    if (error instanceof ExportSpecError) throw new HttpsError("invalid-argument", error.message);
    throw error;
  }
}

/** The sittings an export covers, in the list's order. */
function selectRows(rows: SessionRow[], spec: ExportSpec, actor: Actor, now: Date): SessionRow[] {
  const ctx = { now, timeZone: actor.policy.timeZone };
  let chosen: SessionRow[];
  if (spec.scope === "selected" || spec.scope === "single") {
    const wanted = new Set(spec.sessionIds);
    chosen = rows.filter((r) => wanted.has(r.summary.sessionId));
  } else {
    chosen = rows.filter(makePredicate(spec.filters, ctx));
  }
  return chosen.sort((a, b) => compareRows(a, b, spec.sort));
}

function dateRangeLabel(spec: ExportSpec, actor: Actor, now: Date): { label: string; fromDay: string | null; toDay: string | null } {
  if (spec.scope === "selected" || spec.scope === "single") return { label: "Not applicable (chosen sessions)", fromDay: null, toDay: null };
  const r = rangeFor(spec.filters, { now, timeZone: actor.policy.timeZone });
  if (!r.fromDay && !r.toDay) return { label: "All time", fromDay: null, toDay: null };
  const preset = spec.filters.datePreset === "custom" ? "" : ` (${DATE_PRESET_LABELS[spec.filters.datePreset]})`;
  return { label: `${r.fromDay ?? "start"} to ${r.toDay ?? "now"}${preset}, by ${spec.filters.dateBasis.replace("_", " ")} date`, fromDay: r.fromDay, toDay: r.toDay };
}

async function buildPreview(spec: ExportSpec, actor: Actor, now: Date): Promise<{ preview: ExportPreview; rows: SessionRow[]; releases: ReleaseIndex[] }> {
  const [{ rows }, releases, surveys] = await Promise.all([currentRows(actor.study, now), allReleaseIndexes(actor.study), studySurveys(actor.study)]);
  const chosen = selectRows(rows, spec, actor, now);
  const byVersion = new Map<string, number>();
  for (const r of chosen) byVersion.set(r.summary.releaseHash ?? "unknown", (byVersion.get(r.summary.releaseHash ?? "unknown") ?? 0) + 1);
  const relByHash = new Map(releases.map((r) => [r.hash, r]));
  const versions = [...byVersion.entries()].map(([hash, sessions]) => ({ hash, version: relByHash.get(hash)?.version ?? "unknown", sessions }));
  const included = versions.map((v) => relByHash.get(v.hash)).filter((r): r is ReleaseIndex => !!r);
  const range = dateRangeLabel(spec, actor, now);
  const verdict = authoriseExport(actor.role, spec, actor.policy);

  const warnings: string[] = [];
  if (spec.includeFreeText) warnings.push("Includes free-text answers, which may contain names or other identifying details a participant typed. Store the file only where the study's data management plan allows.");
  if (isSensitive(spec) && !spec.deidentified) {
    warnings.push(
      "Includes identifiers for linkage: participant codes (up to survey version 7.3.0 built from each child's secret-code answers, readable by anyone who knows the scheme; from 8.0.0 made from name and date of birth, recomputable by anyone who has both — pseudonymous either way), study codes, sitting and device IDs and exact times. Names, dates of birth, home addresses, UPNs and NHS numbers are never included.",
    );
  }
  if (spec.kind === "sessions" && spec.format === "bids") {
    warnings.push("Sittings that cannot be linked to a participant (an incomplete secret code or, from 8.0.0, a missing name or date of birth; a quarantined or unreadable sitting) are left out and listed in the README — never silently.");
  }
  if (isSensitive(spec)) warnings.push(`Session-level research data. The file is kept for ${actor.policy.exportRetentionHours} hours on the server, then deleted.`);
  if (chosen.length === 0) warnings.push("No sessions match — the export would be empty.");
  if (spec.kind === "school_report") {
    const minCell = (await studyGroupSettings(actor.study)).minCell;
    warnings.push(`Written to be shared with the school: group averages only, other schools never named, and any group of fewer than ${minCell} pupils withheld.`);
    if (!chosen.some((r) => r.summary.site === spec.school)) warnings.push(`No sittings from ${spec.school} match these filters.`);
  }
  if (versions.some((v) => v.version === "unknown")) warnings.push("Some sessions use a survey version that is not in the registry; their answers cannot be exported against questions.");
  if (spec.kind === "sessions" && spec.includeAnswers && included.length > 1) {
    const incompatible = unionQuestions(included).filter((q) => poolingCompatibility(q.key, included) === "incompatible");
    const caution = unionQuestions(included).filter((q) => poolingCompatibility(q.key, included) === "caution");
    if (incompatible.length) warnings.push(`${incompatible.length} question(s) changed answer type or option codes between the included versions (e.g. ${incompatible.slice(0, 3).map((q) => q.key).join(", ")}). Do not pool them without checking the codebook; use release_version to separate them.`);
    if (caution.length) warnings.push(`${caution.length} question(s) changed wording, labels or conditions between the included versions. See the codebook sheet.`);
  }

  const fields =
    spec.kind === "sessions" && spec.format === "bids"
      ? [
          "README.md and dataset_description.json",
          "participants.tsv — one row per participant",
          "sub-<participant>/sessions.tsv — one row per wave",
          "phenotype/<questionnaire>.tsv — answers as stored codes, with a _status column for every missing value",
          "phenotype/<questionnaire>.json — each question's wording and what every code means",
          "phenotype/scores.tsv — derived scores, where the survey defines scoring",
          ...(spec.deidentified ? [] : ["linkage.tsv — participant codes, study codes, sitting and device IDs, exact times"]),
          ...(spec.includeFreeText ? ["free-text answers and narrative logs"] : []),
          "export_manifest.json — provenance and a checksum for every file",
        ]
      : spec.kind === "sessions"
      ? sessionsTable([], spec, actor.policy.timeZone).headers.concat(spec.includeAnswers ? ["answers by question (stored codes) + __status per question"] : [])
      : spec.kind === "completeness_summary"
        ? ["metrics", "sections", "versions", "most missed", "drop-off", "daily series"]
        : spec.kind === "question_summary"
          ? ["per question: eligible, shown, answered, skipped, invalid, rates, distribution"]
          : spec.kind === "school_report"
            ? ["each measure's school average with a 95% CI, against the other schools combined and the benchmarks", "shares in each threshold band", "the school's year groups"]
            : ["session details", "answers in that version's wording", "review status and flags"];

  const describe = describeFilters(spec.filters, {
    version: (h) => relByHash.get(h)?.version ?? h.slice(7, 15),
    survey: (id) => surveys.find((x) => x.surveyId === id)?.title ?? id,
  }).map((c) => c.label);

  return {
    rows: chosen,
    releases,
    preview: {
      kind: spec.kind,
      kindLabel: EXPORT_KIND_LABELS[spec.kind],
      format: spec.format,
      scope: spec.scope,
      scopeLabel: EXPORT_SCOPE_LABELS[spec.scope],
      sessionCount: chosen.length,
      dateRange: range.label,
      filters: spec.scope === "filtered" ? describe : [],
      versions,
      fields,
      includesAnswers: spec.includeAnswers,
      includesFreeText: spec.includeFreeText,
      includesStudyCode: spec.includeStudyCode,
      deidentified: spec.deidentified,
      fileName: exportFileName(spec, range, now, { study: actor.study, survey: exportSurvey(spec) }),
      sensitive: isSensitive(spec),
      warnings,
      allowed: verdict.ok,
      refusal: verdict.ok ? null : verdict.reason,
      retentionHours: actor.policy.exportRetentionHours,
    },
  };
}

export const previewExport = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<ExportPreview> => {
  const actor = await requireStudyActor(request, "export.aggregate");
  const spec = parseSpec(request.data);
  return (await buildPreview(spec, actor, new Date())).preview;
});

const MIME: Record<ExportSpec["format"], string> = {
  bids: "application/zip",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  json: "application/json; charset=utf-8",
};

function jobView(id: string, d: Record<string, unknown>): ExportJobView {
  const ts = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : null);
  return {
    id,
    status: d["status"] as ExportJobView["status"],
    progress: typeof d["progress"] === "number" ? (d["progress"] as number) : 0,
    fileName: String(d["fileName"] ?? ""),
    kind: d["kind"] as ExportJobView["kind"],
    format: d["format"] as ExportJobView["format"],
    rowCount: typeof d["rowCount"] === "number" ? (d["rowCount"] as number) : null,
    bytes: typeof d["bytes"] === "number" ? (d["bytes"] as number) : null,
    createdAt: ts(d["createdAt"]),
    expiresAt: ts(d["expiresAt"]),
    error: typeof d["error"] === "string" ? (d["error"] as string) : null,
  };
}

/** Records with answers, read from the study's raw logs in batches, reporting progress. */
async function withAnswers(study: string, rows: SessionRow[], spec: ExportSpec, onProgress: (done: number) => Promise<void>): Promise<SessionRecord[]> {
  const policy = await studyPolicy(study);
  const out: SessionRecord[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const sittings = await readSittings(study, batch.map((r) => r.summary.sessionId));
    for (const row of batch) {
      const sitting = sittings.get(row.summary.sessionId);
      const release = sitting ? await releaseIndex(study, sitting.releaseHash) : null;
      if (!sitting || !release) {
        out.push({ row });
        continue;
      }
      const { assessment } = buildSummary(sitting, release, policy, { now: new Date() });
      out.push({ row, assessment, release });
    }
    await onProgress(Math.min(rows.length, i + batch.length));
  }
  void spec;
  return out;
}

/**
 * The BIDS dataset: the survey's layout, built by the survey's own code over
 * the whole study (so participant codes and waves are the survey's), then
 * restricted to the chosen sittings.
 */
async function bidsFile(spec: ExportSpec, actor: Actor, rows: SessionRow[], exportId: string, filters: string[], now: Date, progress: (p: number) => Promise<void>) {
  const { study, sittings } = await loadStudyDataset(actor.study, { fresh: true, onProgress: (f) => progress(0.05 + 0.6 * f) });
  const [manifests, indexes, metas] = await Promise.all([surveyManifests(actor.study), allReleaseIndexes(actor.study), releaseList(actor.study)]);
  const version = (h: string) => metas.find((m) => m.hash === h)?.version ?? "0";
  const included = [...new Set(rows.map((r) => r.summary.releaseHash).filter((h): h is string => !!h && manifests.has(h)))];
  const sidecar = (included.length ? included : [...manifests.keys()]).sort((a, b) => compareVersions(version(b), version(a)))[0];
  if (!sidecar) throw new HttpsError("failed-precondition", "No registered survey version can be read, so there is nothing to build a BIDS dataset from.");
  const narratives = spec.includeFreeText ? await readNarratives(actor.study) : [];
  // Scores from the study's scoring schemes, not the survey's own definitions (docs/08).
  const scoring = await scoredSessions(actor.study);
  await progress(0.8);
  const result = buildDashboardBids({
    study: actor.study,
    survey: exportSurvey(spec),
    studyData: study,
    selected: new Set(rows.map((r) => r.summary.sessionId)),
    sittings,
    manifest: manifests.get(sidecar)!,
    releaseVersions: new Map(metas.map((m) => [m.hash, m.version])),
    identifiers: !spec.deidentified,
    includeFreeText: spec.includeFreeText,
    freeTextVariables: new Set(indexes.flatMap((r) => r.questions.filter((q) => q.freeText && !q.identifying).map((q) => q.variable))),
    narratives,
    provenance: {
      exportId,
      createdAt: now.toISOString(),
      createdBy: actor.email,
      role: actor.role,
      scope: EXPORT_SCOPE_LABELS[spec.scope],
      dateRange: dateRangeLabel(spec, actor, now).label,
      filters,
      rulesVersion: RULES_VERSION,
    },
    hash: sha256,
    scoring: { schemes: scoring.schemes, bySession: new Map(scoring.sessions.map((x) => [x.sessionId, x.scores])) },
    releases: indexes.filter((r) => included.includes(r.hash)),
  });
  return {
    body: Buffer.from(result.zip),
    rowCount: result.sessions,
    notes: { participants: result.participants, notIncluded: result.excluded.length, codeCollisions: result.collisions.length },
  };
}

async function generate(
  spec: ExportSpec,
  actor: Actor,
  rows: SessionRow[],
  releases: ReleaseIndex[],
  now: Date,
  progress: (p: number) => Promise<void>,
  context: { exportId: string; filters: string[] },
): Promise<{ body: Buffer; rowCount: number; notes?: Record<string, number> }> {
  const tz = actor.policy.timeZone;
  switch (spec.kind) {
    case "sessions": {
      if (spec.format === "bids") return bidsFile(spec, actor, rows, context.exportId, context.filters, now, progress);
      // Participant codes and waves, as the survey derives them, for every format.
      const { study } = await loadStudyDataset(actor.study, { fresh: true, onProgress: (f) => progress(0.02 + 0.2 * f) });
      const linkage = participantsFor(study, rows.map((r) => r.summary.sessionId), spec.deidentified);
      const link = (rec: SessionRecord): SessionRecord => {
        const l = linkage.get(rec.row.summary.sessionId);
        return { ...rec, participant: l?.participant ?? null, wave: l?.wave ?? null };
      };
      const records: SessionRecord[] = (
        spec.includeAnswers ? await withAnswers(actor.study, rows, spec, (done) => progress(0.25 + (0.6 * done) / Math.max(1, rows.length))) : rows.map((row) => ({ row }))
      ).map(link);
      const table = sessionsTable(records, spec, tz);
      const included = [...new Map(records.filter((r) => r.release).map((r) => [r.release!.hash, r.release!])).values()];
      if (spec.format === "csv") return { body: csvOf(table), rowCount: table.rows.length };
      if (spec.format === "xlsx") {
        const tables: Table[] = [table];
        if (spec.includeAnswers) tables.push(codebookTable(included));
        return { body: await xlsxOf(tables, { title: "MySelf sessions export", createdBy: actor.email }), rowCount: table.rows.length };
      }
      // JSON (administrators only — enforced by authoriseExport).
      const labels = exportSessionLabels(records);
      const json = {
        study: actor.study,
        survey: exportSurvey(spec),
        generatedAt: now.toISOString(),
        generatedBy: actor.email,
        spec: { ...spec, sessionIds: spec.scope === "selected" ? spec.sessionIds : [] },
        sessions: records.map((r) => ({
          ...(spec.deidentified
            ? deidentifiedListItem(toListItem(r.row, { studyCodes: spec.includeStudyCode }), labels.get(r.row.summary.sessionId)!, tz)
            : toListItem(r.row, { studyCodes: spec.includeStudyCode })),
          ...(spec.deidentified ? { participantLabel: r.participant ?? null } : { participantCode: r.participant ?? null }),
          wave: r.wave ?? null,
          ...(spec.includeAnswers && r.assessment && r.release ? { answers: presentAnswers(r.assessment, r.release, { freeText: spec.includeFreeText }) } : {}),
        })),
      };
      return { body: Buffer.from(JSON.stringify(json, null, 2), "utf8"), rowCount: records.length };
    }
    case "session_report": {
      const row = rows[0];
      if (!row) throw new HttpsError("not-found", "That session is not available.");
      const sessionId = row.summary.sessionId;
      const [[record], notesSnap] = await Promise.all([
        withAnswers(actor.study, [row], spec, async () => undefined),
        dash().collection(dpaths.notes(actor.study, sessionId)).orderBy("createdAt", "asc").limit(500).get(),
      ]);
      const review: ReviewDoc = row.review ?? ({ status: "unreviewed", flags: [], qualityConcerns: [], markedTest: false, markedInvalid: false, lastReviewedAt: null } as unknown as ReviewDoc);
      // The participant code, wave and their other sittings — only when the report carries identifiers.
      let participant: Parameters<typeof sessionReportPdf>[0]["participant"] = null;
      if (!spec.deidentified) {
        const { study } = await loadStudyDataset(actor.study);
        const self = study.dataset.sessions.find((s) => s.sessionId === sessionId);
        if (self) {
          participant = {
            code: self.participantId,
            wave: self.wave,
            sittings: study.dataset.sessions
              .filter((s) => s.participantId === self.participantId)
              .sort((a, b) => a.wave - b.wave)
              .map((s) => ({ sessionId: s.sessionId, wave: s.wave, startedAt: s.startedAt, complete: s.complete })),
          };
        }
      }
      const listed = toListItem(row, { studyCodes: spec.includeStudyCode });
      const body = await sessionReportPdf({
        item: spec.deidentified ? deidentifiedListItem(listed, "S00001", tz) : listed,
        releaseLabel: record?.release ? `v${record.release.version} (${record.release.key})` : "Unknown version",
        sections: record?.assessment && record.release ? presentAnswers(record.assessment, record.release, { freeText: spec.includeFreeText }) : null,
        review,
        notes: notesSnap.docs.map((n) => {
          const v = n.data();
          const at = v["createdAt"] as Timestamp | undefined;
          return { text: String(v["text"] ?? ""), authorEmail: (v["authorEmail"] as string | undefined) ?? null, createdAt: at?.toDate ? at.toDate().toISOString() : null };
        }),
        warnings: row.status.signals,
        estimateReasons: row.summary.estimateReasons,
        participant,
        generatedBy: actor.email,
        generatedAt: now,
        timeZone: tz,
        includeStudyCode: spec.includeStudyCode,
        includeFreeText: spec.includeFreeText,
        retentionHours: actor.policy.exportRetentionHours,
      });
      return { body, rowCount: 1 };
    }
    case "completeness_summary": {
      const ctx = { now, timeZone: tz };
      const analytics = computeAnalytics(rows, { ...ctx, range: rangeFor(spec.filters, ctx), releases });
      if (spec.format === "pdf") {
        const versionLabel = (hash: string) => {
          const r = releases.find((x) => x.hash === hash);
          return r ? `v${r.version}` : "an unregistered version";
        };
        const filters = describeFilters(spec.filters, { version: versionLabel })
          .filter((f) => f.key !== "date")
          .map((c) => c.label);
        const dateRange = dateRangeLabel(spec, actor, now).label;
        // Figure 1 is the Figures page's default figure, drawn by the same renderer.
        const figure =
          analytics.metrics.started > 0
            ? composeFigure(
                { ...DEFAULT_FIGURE, title: "Participation and data completeness" },
                {
                  analytics,
                  questions: {},
                  period: dateRange,
                  filters,
                  timeZone: tz,
                  rulesVersion: RULES_VERSION,
                  requiredLevels: actor.policy.requiredLevels,
                  abandonAfterHours: actor.policy.abandonAfterHours,
                  versionLabel,
                },
                { createdAt: now.toISOString() },
              )
            : null;
        const body = await completenessPdf({
          analytics,
          figure,
          filters,
          dateRange,
          generatedBy: actor.email,
          generatedAt: now,
          timeZone: tz,
          rulesVersion: RULES_VERSION,
          abandonAfterHours: actor.policy.abandonAfterHours,
          requiredLevels: actor.policy.requiredLevels,
        });
        return { body, rowCount: analytics.metrics.started };
      }
      const tables = completenessTables(analytics);
      return {
        body: spec.format === "xlsx" ? await xlsxOf(tables, { title: "MySelf completeness summary", createdBy: actor.email }) : stackedCsvOf(tables),
        rowCount: analytics.metrics.started,
      };
    }
    case "school_report": {
      const { sessions, schemes, settings } = await scoredSessions(actor.study);
      const allowed = new Set(rows.map((r) => r.summary.sessionId));
      const view = buildSchoolReportView(
        sessions.filter((x) => allowed.has(x.sessionId)),
        { schemes, settings, observation: spec.observation, school: spec.school!, yearGroup: spec.yearGroup ?? null, now },
      );
      if (view.counts.pupils === 0) throw new HttpsError("failed-precondition", "No scored sittings from that school match these filters.");
      const filters = describeFilters(spec.filters).filter((f) => f.key !== "date").map((c) => c.label);
      const period = dateRangeLabel(spec, actor, now).label;
      const body = await schoolReportPdf({
        view,
        figureBase: { period, filters, timeZone: tz, rulesVersion: RULES_VERSION, requiredLevels: actor.policy.requiredLevels, abandonAfterHours: actor.policy.abandonAfterHours, versionLabel: (h) => h },
        generatedBy: actor.email,
        generatedAt: now,
        timeZone: tz,
        period,
        filters,
      });
      return { body, rowCount: view.counts.pupils };
    }
    case "question_summary": {
      const release = releases.find((r) => r.hash === spec.versionHash);
      if (!release) throw new HttpsError("not-found", "That survey version is not in the registry.");
      const table = questionTable(computeQuestionStats(rows, release, actor.policy.requiredLevels), release);
      return {
        body: spec.format === "xlsx" ? await xlsxOf([table, codebookTable([release])], { title: `MySelf questions ${release.version}`, createdBy: actor.email }) : csvOf(table),
        rowCount: table.rows.length,
      };
    }
  }
}

export const createExport = onCall({ ...callableOptions, memory: "2GiB", timeoutSeconds: 540 }, async (request): Promise<ExportJobView> => {
  const actor = await requireStudyActor(request, "export.aggregate");
  const spec = parseSpec(request.data);
  const now = new Date();
  const { preview, rows, releases } = await buildPreview(spec, actor, now);
  const survey = exportSurvey(spec);
  const describe = { study: actor.study, ...(survey ? { survey } : {}), kind: spec.kind, format: spec.format, scope: spec.scope, sessions: preview.sessionCount, filters: preview.filters, dateRange: preview.dateRange, includesFreeText: spec.includeFreeText, includesStudyCode: spec.includeStudyCode, identifiers: !spec.deidentified && isSensitive(spec), deidentified: spec.deidentified, includesAnswers: spec.includeAnswers, ...(spec.kind === "school_report" ? { school: spec.school, yearGroup: spec.yearGroup ?? null } : {}) };
  if (!preview.allowed) {
    await audit({ action: "export.created", ...actorFields(actor), detail: { ...describe, refusal: preview.refusal }, outcome: "denied" });
    throw new HttpsError("permission-denied", preview.refusal ?? "not permitted");
  }
  if (preview.sessionCount === 0 && spec.kind !== "question_summary") throw new HttpsError("failed-precondition", "No sessions match — there is nothing to export.");

  const db = dash();
  const jobRef = db.collection(dpaths.exportJobs(actor.study)).doc();
  const expiresAt = Timestamp.fromMillis(now.getTime() + actor.policy.exportRetentionHours * 3_600_000);
  await jobRef.set({
    study: actor.study,
    survey,
    requestedBy: actor.uid,
    requestedByEmail: actor.email,
    requestedByRole: actor.role,
    kind: spec.kind,
    format: spec.format,
    scope: spec.scope,
    fileName: preview.fileName,
    preview: { sessionCount: preview.sessionCount, dateRange: preview.dateRange, filters: preview.filters, versions: preview.versions.map((v) => v.version), includesFreeText: spec.includeFreeText, includesStudyCode: spec.includeStudyCode, deidentified: spec.deidentified },
    status: "running",
    progress: 0.02,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    error: null,
  });

  let lastWrite = 0;
  const progress = async (p: number) => {
    // At most one progress write a second: enough for a smooth bar, cheap on writes.
    if (Date.now() - lastWrite < 1000) return;
    lastWrite = Date.now();
    await jobRef.update({ progress: Math.min(0.95, p) });
  };

  try {
    const { body, rowCount, notes } = await generate(spec, actor, rows, releases, now, progress, { exportId: jobRef.id, filters: preview.filters });
    const storagePath = `${EXPORT_PREFIX}/${jobRef.id}/${preview.fileName}`;
    await bucket().file(storagePath).save(body, {
      resumable: false,
      contentType: MIME[spec.format],
      metadata: { cacheControl: "private, no-store", metadata: { jobId: jobRef.id, requestedBy: actor.uid } },
    });
    await jobRef.update({ status: "ready", progress: 1, rowCount, bytes: body.length, storagePath, readyAt: FieldValue.serverTimestamp(), ...(notes ? { notes } : {}) });
    await audit({ action: "export.created", ...actorFields(actor), target: { type: "export", id: jobRef.id }, detail: { ...describe, fileName: preview.fileName, bytes: body.length, rowCount, ...(notes ?? {}) } });
  } catch (error) {
    const message = error instanceof HttpsError ? error.message : "The export could not be generated. Nothing was saved; try again, or narrow the filters.";
    logger.error("export failed", { jobId: jobRef.id, error: String(error) });
    await jobRef.update({ status: "failed", error: message });
    await audit({ action: "export.failed", ...actorFields(actor), target: { type: "export", id: jobRef.id }, detail: { ...describe, error: String(error).slice(0, 300) }, outcome: "failed" });
  }
  const snap = await jobRef.get();
  return jobView(jobRef.id, snap.data()!);
});

/**
 * The only way to fetch an export file. GET `?study=<study>&job=<id>` with
 * `Authorization: Bearer <ID token>` (no study means the default one, as every
 * download meant before there were several). Checks the token (and that it has
 * not been revoked), the caller's current access to the dashboard and to the
 * study, that the export is theirs (or they administer the dashboard), and that
 * it has not expired — then streams it. Every download, and every refusal, is
 * audited in the study's log.
 */
export const downloadExport = onRequest({ cors: ALLOWED_ORIGINS, memory: "512MiB", timeoutSeconds: 300 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.status(405).json({ error: "use GET" });
    return;
  }
  const jobId = typeof req.query["job"] === "string" ? (req.query["job"] as string) : "";
  if (!/^[A-Za-z0-9]{10,40}$/.test(jobId)) {
    res.status(400).json({ error: "which export? pass ?job=<id>" });
    return;
  }
  const found = await lookupStudy(typeof req.query["study"] === "string" ? req.query["study"] : undefined);
  if (found.kind !== "registered") {
    res.status(found.kind === "malformed" ? 400 : 404).json({ error: found.kind === "malformed" ? "study must be a study id" : "There is no such study." });
    return;
  }
  const study = found.study;
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let decoded;
  try {
    if (!token) throw new Error("no token");
    decoded = await auth().verifyIdToken(token, true);
  } catch {
    res.status(401).json({ error: "Sign in again to download this export." });
    return;
  }
  const facts = tokenFacts(decoded as unknown as Record<string, unknown>, decoded.uid);
  const decision = decideAccess(facts, await accountFacts(decoded.uid), await accessPolicy());
  const deny = async (status: number, message: string) => {
    await audit({ action: "export.download_denied", actorUid: decoded.uid, actorEmail: facts?.email ?? null, actorRole: decision.ok ? decision.role : null, study, target: { type: "export", id: jobId }, detail: { reason: message }, outcome: "denied" });
    res.status(status).json({ error: message });
  };
  if (!decision.ok) return deny(403, decision.reason);
  if (!decideStudyAccess({ role: decision.role, email: decision.email, study, defaultStudy: DEFAULT_STUDY, list: await studyAccessList(study) })) {
    return deny(403, "You have not been given access to this export's study.");
  }
  const job = await dash().doc(dpaths.exportJob(study, jobId)).get();
  const data = job.data() ?? {};
  if (!job.exists) return deny(404, "No such export.");
  if (data["requestedBy"] !== decoded.uid && decision.role !== "owner") return deny(403, "Only the person who created an export (or an administrator) can download it.");
  const policy = await studyPolicy(study);
  if (!can(decision.role, data["kind"] === "sessions" || data["kind"] === "session_report" ? "export.sessions" : "export.aggregate", policy)) {
    return deny(403, "Your role no longer allows this export.");
  }
  if (data["status"] !== "ready") return deny(409, data["status"] === "expired" ? "This export has expired and been deleted. Create it again." : "This export is not ready.");
  const expires = data["expiresAt"] instanceof Timestamp ? (data["expiresAt"] as Timestamp).toMillis() : 0;
  if (expires <= Date.now()) return deny(410, "This export has expired. Create it again.");

  const fileName = String(data["fileName"]);
  const file = bucket().file(String(data["storagePath"]));
  const [exists] = await file.exists();
  if (!exists) return deny(410, "This export's file is no longer available. Create it again.");
  await audit({ action: "export.downloaded", actorUid: decoded.uid, actorEmail: decision.email, actorRole: decision.role, study, target: { type: "export", id: jobId }, detail: { fileName } });
  res.set("Content-Type", MIME[data["format"] as ExportSpec["format"]] ?? "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="${fileName.replace(/[^a-z0-9._-]/gi, "")}"`);
  await new Promise<void>((resolve, reject) => {
    file.createReadStream().on("error", reject).on("end", () => resolve()).pipe(res);
  });
});

/** Delete export files past their retention and mark their jobs expired, in every study. */
export async function expireExports(now = new Date()): Promise<number> {
  const db = dash();
  let expired = 0;
  for (const { study } of await registeredStudies(true)) {
    const due = await db.collection(dpaths.exportJobs(study)).where("expiresAt", "<=", Timestamp.fromDate(now)).limit(500).get();
    for (const d of due.docs) {
      if (d.data()["status"] === "expired") continue;
      const path = d.data()["storagePath"];
      if (typeof path === "string") await bucket().file(path).delete({ ignoreNotFound: true });
      await d.ref.update({ status: "expired", storagePath: null, expiredAt: FieldValue.serverTimestamp() });
      expired += 1;
    }
  }
  return expired;
}

export const cleanupExports = onSchedule({ schedule: "every 60 minutes", timeZone: "Etc/UTC" }, async () => {
  const n = await expireExports();
  if (n > 0) logger.info("expired exports deleted", { count: n });
});

export { jobView };
