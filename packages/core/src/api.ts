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
