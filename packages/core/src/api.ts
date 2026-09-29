import type { Analytics } from "./analytics.js";
import type { Counts } from "./completeness.js";
import type { FilterState, SessionRow, SortState } from "./filters.js";
import type { Policy } from "./policy.js";
import type { Neighbours } from "./query.js";
import type { QuestionStat, QuestionVersionEntry, ReleaseComparison } from "./questions.js";
import type { ReviewChange, ReviewDoc, ReviewStatus } from "./review.js";
import type { Capability, Role } from "./roles.js";
import { maskStudyCode } from "./roles.js";
import type { SectionView } from "./present.js";
import type { SectionSummary } from "./summary.js";
import type { DisplayStatus, Lifecycle, Marker } from "./status.js";
import type { ExportFormat, ExportKind, ExportScope, ExportSpecInput } from "./exportSpec.js";
import type { Observation } from "./scoring/aggregate.js";
import type { ScoreFocus, ScoreGroupBy } from "./scoring/benchmark.js";
import type { SchemeIssue } from "./scoring/check.js";
import type { GroupSettings, YearGroupSource } from "./scoring/groups.js";
import type { ScoringScheme } from "./scoring/scheme.js";
import type { CodebookRow, QualityReport } from "./quality/types.js";

/**
 * The contract between the web app and the backend, defined once so both sides
 * compile against the same shapes (the survey learned why in sync-contract.ts).
 */

export interface ReleaseMetaView {
  hash: string;
  key: string;
  version: string;
  publishedAt: string;
  title: string;
  questionCount: number;
  sectionCount: number;
}

export interface StatusView {
  display: DisplayStatus;
  lifecycle: Lifecycle;
  markers: Marker[];
  signals: string[];
  openFlags: number;
}

export interface SessionListItem {
  sessionId: string;
  /** Masked ("NDC••42") for roles that may not see study codes. */
  studyCode: string | null;
  studyCodeMasked: boolean;
  site: string | null;
  releaseHash: string | null;
  releaseVersion: string | null;
  releaseKnown: boolean;
  provenance: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  receivedAt: string | null;
  firstReceivedAt: string | null;
  durationMs: number | null;
  wallClockMs: number | null;
  requiredCompletion: number | null;
  estimated: boolean;
  requiredTotal: number | null;
  requiredMissing: number | null;
  invalidCount: number | null;
  finalSectionKey: string | null;
  finalSectionTitle: string | null;
  lastPresentedKey: string | null;
  status: StatusView;
  reviewStatus: ReviewStatus;
  lastReviewedAt: string | null;
  flagReasons: string[];
}

export function toListItem(row: SessionRow, options: { studyCodes: boolean; sectionTitle?: (key: string) => string | undefined }): SessionListItem {
  const s = row.summary;
  return {
    sessionId: s.sessionId,
    studyCode: options.studyCodes ? s.studyCode : maskStudyCode(s.studyCode),
    studyCodeMasked: !options.studyCodes,
    site: s.site,
    releaseHash: s.releaseHash,
    releaseVersion: s.releaseVersion,
    releaseKnown: s.releaseKnown,
    provenance: s.provenance,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    completedAt: s.completedAt,
    receivedAt: s.receivedAt,
    firstReceivedAt: s.firstReceivedAt,
    durationMs: s.durationMs,
    wallClockMs: s.wallClockMs,
    requiredCompletion: s.requiredCompletion,
    estimated: s.estimated,
    requiredTotal: s.releaseKnown ? s.counts.required : null,
    requiredMissing: s.releaseKnown ? s.counts.requiredMissing : null,
    invalidCount: s.releaseKnown ? s.counts.invalid : null,
    finalSectionKey: s.finalSectionKey,
    finalSectionTitle: s.finalSectionKey ? (options.sectionTitle?.(s.finalSectionKey) ?? null) : null,
    lastPresentedKey: s.lastPresentedKey,
    status: {
      display: row.status.display,
      lifecycle: row.status.lifecycle,
      markers: row.status.markers,
      signals: row.status.signals,
      openFlags: row.status.openFlags,
    },
    reviewStatus: row.review?.status ?? "unreviewed",
    lastReviewedAt: row.review?.lastReviewedAt ?? null,
    flagReasons: row.review?.flags.filter((f) => f.open).map((f) => f.reason) ?? [],
  };
}

// ── whoAmI ────────────────────────────────────────────────────────────────

export interface PublicPolicy {
  timeZone: string;
  abandonAfterHours: number;
  requiredLevels: Policy["requiredLevels"];
  reviewerCanViewFreeText: boolean;
  exportRetentionHours: number;
  tooFastWarningCount: number;
  testCodePatterns: string[];
  activeReleaseHash: string | null;
}

export interface WhoAmIResponse {
  authorised: boolean;
  reason: string | null;
  email: string | null;
  uid: string | null;
  role: Role | null;
  capabilities: Capability[];
  policy: PublicPolicy | null;
  study: string;
}

// ── sessions ──────────────────────────────────────────────────────────────

export interface QuerySessionsRequest {
  filters: FilterState;
  sort: SortState;
  search: string;
  page: number;
  pageSize: number;
}

export interface QuerySessionsResponse {
  items: SessionListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  computedAt: string;
}

export interface NoteView {
  id: string;
  text: string;
  authorUid: string;
  authorEmail: string | null;
  createdAt: string | null;
}

export interface SessionDetailRequest {
  sessionId: string;
  /** The list the researcher came from, for previous/next. */
  context?: { filters: FilterState; sort: SortState; search: string; pageSize: number };
}

export interface SessionDetailResponse {
  item: SessionListItem;
  counts: Counts | null;
  sections: SectionSummary[];
  estimateReasons: string[];
  warnings: string[];
  resumedCount: number;
  reviewEdits: number;
  backNavigations: number;
  tooFastCount: number;
  eventCount: number;
  deviceId: string | null;
  release: ReleaseMetaView | null;
  /** Grouped by section in the wording of THIS sitting's release; null when unavailable. */
  answers: SectionView[] | null;
  /** Questions in the newest release that this sitting's version did not have. */
  notInVersion: { key: string; text: string; version: string }[];
  review: ReviewDoc;
  notes: NoteView[];
  neighbours: Neighbours | null;
  permissions: { review: boolean; freeText: boolean; studyCode: boolean };
}

export interface UpdateReviewRequest {
  sessionId: string;
  change: ReviewChange;
  /** The review revision the change was based on; refused if stale. */
  expectedRev: number;
}

export interface AddNoteRequest {
  sessionId: string;
  text: string;
}

// ── analytics ─────────────────────────────────────────────────────────────

export interface AnalyticsRequest {
  filters: FilterState;
}

export interface Freshness {
  lastSummaryAt: string | null;
  summaryCount: number;
  rulesVersion: string | null;
}

export interface AnalyticsResponse {
  analytics: Analytics;
  freshness: Freshness;
  releases: ReleaseMetaView[];
  activeReleaseHash: string | null;
}

export interface QuestionAnalyticsRequest {
  filters: FilterState;
  versionHash: string;
  compareWith?: string | null;
}

export interface QuestionAnalyticsResponse {
  release: ReleaseMetaView;
  stats: QuestionStat[];
  comparison: ReleaseComparison | null;
  sessions: number;
  computedAt: string;
}

export interface QuestionHistoryRequest {
  key: string;
}

export interface QuestionHistoryResponse {
  key: string;
  entries: QuestionVersionEntry[];
}

// ── exports ───────────────────────────────────────────────────────────────

export type ExportRequest = ExportSpecInput;

export interface ExportPreview {
  kind: ExportKind;
  kindLabel: string;
  format: ExportFormat;
  scope: ExportScope;
  scopeLabel: string;
  sessionCount: number;
  dateRange: string;
  filters: string[];
  versions: { hash: string; version: string; sessions: number }[];
  fields: string[];
  includesAnswers: boolean;
  includesFreeText: boolean;
  includesStudyCode: boolean;
  deidentified: boolean;
  fileName: string;
  sensitive: boolean;
  warnings: string[];
  allowed: boolean;
  refusal: string | null;
  retentionHours: number;
}

export interface ExportJobView {
  id: string;
  status: "running" | "ready" | "failed" | "expired";
  progress: number;
  fileName: string;
  kind: ExportKind;
  format: ExportFormat;
  rowCount: number | null;
  bytes: number | null;
  createdAt: string | null;
  expiresAt: string | null;
  error: string | null;
}

// ── administration ────────────────────────────────────────────────────────

export interface PersonView {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role | null;
  allowed: boolean;
  disabled: boolean;
  lastSignIn: string | null;
}

export interface SettingsResponse {
  access: { emails: string[]; domains: string[] };
  policy: Policy;
  people: PersonView[];
  releases: ReleaseMetaView[];
}

// ── participants (linkage) ────────────────────────────────────────────────

/** Why a participant row may need a researcher's attention. */
export type ParticipantAttention = "shared_code" | "same_day" | "never_finished";

export const PARTICIPANT_ATTENTION_LABELS: Record<ParticipantAttention, string> = {
  shared_code: "Code shared by more than one child",
  same_day: "Two sittings within a day",
  never_finished: "No finished sitting",
};

export interface ParticipantSittingView {
  sessionId: string;
  wave: number;
  startedAt: string;
  /** The survey's own flag: the participant reached the end. */
  finished: boolean;
  /** The dashboard's status, when the sitting has been summarised. */
  status: DisplayStatus | null;
  releaseVersion: string | null;
  site: string | null;
  /** "parent" or "teacher" when someone else answered about the participant. */
  informant: string | null;
  daysSincePrevious: number | null;
}

export interface ParticipantView {
  /** The participant code — or, for roles that may not see codes, a label (P0001…) that means nothing outside this page. */
  code: string;
  sittings: ParticipantSittingView[];
  waves: number;
  firstSeen: string;
  lastSeen: string;
  sites: string[];
  attention: ParticipantAttention[];
}

export interface HeldBackSittingView {
  sessionId: string;
  reason: string;
  startedAt: string | null;
  status: DisplayStatus | null;
  site: string | null;
}

export interface ParticipantsResponse {
  computedAt: string;
  /** False for roles that see labels instead of codes. */
  codesShown: boolean;
  totals: {
    participants: number;
    linkedSittings: number;
    heldBack: number;
    multiWave: number;
    byWave: { waves: number; participants: number }[];
    sharedCodes: number;
    sameDay: number;
  };
  participants: ParticipantView[];
  heldBack: HeldBackSittingView[];
  /** Codes two children appear to share (almost always twins). Names never leave the server. */
  sharedCodes: { code: string; sessionIds: string[] }[];
}

// ── scores ────────────────────────────────────────────────────────────────

export interface ScoresRequest {
  filters?: FilterState;
  observation?: Observation;
  groupBy?: ScoreGroupBy;
  focus?: ScoreFocus | null;
  /** Administrators: preview an unsaved scheme in place of the saved one. */
  draft?: unknown;
}

export interface SchemeSettingsView {
  scheme: ScoringScheme;
  /** "study" when the study has saved its own version. */
  source: "default" | "study";
  /** The dashboard default's version, for a scheme that has one. */
  defaultVersion: string | null;
  differsFromDefault: boolean;
  savedAt: string | null;
  savedBy: string | null;
  reason: string | null;
  history: { version: string; savedAt: string | null; savedBy: string | null; reason: string | null; verified: boolean }[];
  checks: { version: string; issues: SchemeIssue[] }[];
  /** Linked sittings whose version administers the instrument. */
  sittings: number;
}

export interface ScoringSettingsView {
  schemes: SchemeSettingsView[];
  defaults: ScoringScheme[];
  groups: GroupSettings;
  groupStats: {
    sittings: number;
    yearGroupSources: Record<YearGroupSource | "unknown", number>;
    schools: { key: string; n: number }[];
  };
  canEdit: boolean;
}

export interface SaveSchemeRequest {
  scheme: unknown;
  reason: string;
  /** Record the saving administrator as having checked the scheme against its source. */
  markVerified?: boolean;
  verifyNote?: string;
}

/** The codebook of one survey version, with the quality review of every version and the current schemes. */
export interface CodebookResponse extends QualityReport {
  releases: { hash: string; version: string; active: boolean }[];
}

/** A codebook as a table: one row per question, for a spreadsheet or a data-management plan. */
export function codebookCsvRows(rows: readonly CodebookRow[]): { headers: string[]; rows: (string | number | null)[][] } {
  return {
    headers: ["name", "label", "question_key", "survey_variable", "qualtrics_variable", "section", "wording", "context", "answer_type", "unit", "required", "conditional", "identifying", "codes", "scored_as", "survey_versions", "review_findings"],
    rows: rows.map((r) => [
      r.name,
      r.label,
      r.key,
      r.variable,
      r.legacyVariable,
      r.section,
      r.text,
      r.lede,
      r.responseType,
      r.unit,
      r.required,
      r.conditional ? "yes" : "no",
      r.identifying ? "yes" : "no",
      r.options.map((o) => `${o.code}=${o.label}${o.kind !== "substantive" ? ` [${o.kind}]` : ""}`).join(" | ") || null,
      r.scoring.map((u) => `${u.schemeName} ${u.outputLabel}${u.values ? ` (${u.values.map((v) => v ?? "missing").join(", ")})` : " (as answered)"}${u.transform ? `, ${u.transform}` : ""}`).join("; ") || null,
      r.versions.join(" "),
      r.findings.join(" ") || null,
    ]),
  };
}
