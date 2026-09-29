import { z } from "zod";
import { can, type Role } from "./roles.js";
import { sanitiseFilters, sanitiseSort, type FilterState, type SortState } from "./filters.js";
import { OBSERVATIONS, type Observation } from "./scoring/aggregate.js";

/**
 * What an export may contain, who may ask for it, and what it is called.
 * Checked on the SERVER against the caller's role for every export; the dialog
 * in the browser shows the same decisions but does not make them.
 */

export const EXPORT_KINDS = ["sessions", "session_report", "completeness_summary", "question_summary", "school_report"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  sessions: "Session data",
  session_report: "Formatted session report",
  completeness_summary: "Completeness summary",
  question_summary: "Question-level summary",
  school_report: "School report",
};

export const EXPORT_FORMATS = ["bids", "csv", "xlsx", "pdf", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  bids: "BIDS dataset (.zip)",
  csv: "CSV",
  xlsx: "Excel (XLSX)",
  pdf: "PDF",
  json: "JSON",
};

/** The file extension each format is written with. */
export const FORMAT_EXTENSION: Record<ExportFormat, string> = { bids: "zip", csv: "csv", xlsx: "xlsx", pdf: "pdf", json: "json" };

export const FORMATS_BY_KIND: Record<ExportKind, readonly ExportFormat[]> = {
  sessions: ["bids", "csv", "xlsx", "json"],
  session_report: ["pdf"],
  completeness_summary: ["csv", "xlsx", "pdf"],
  question_summary: ["csv", "xlsx"],
  school_report: ["pdf"],
};

export const EXPORT_SCOPES = ["all", "filtered", "selected", "single"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_SCOPE_LABELS: Record<ExportScope, string> = {
  all: "All permitted sessions",
  filtered: "Current filtered sessions",
  selected: "Selected sessions",
  single: "This session",
};

export const MAX_SELECTED = 5000;

export const exportSpecSchema = z.object({
  kind: z.enum(EXPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  scope: z.enum(EXPORT_SCOPES),
  sessionIds: z.array(z.string().min(1).max(120)).max(MAX_SELECTED).default([]),
  filters: z.unknown().optional(),
  sort: z.unknown().optional(),
  /** Include answers (sessions export) — otherwise session-level fields only. */
  includeAnswers: z.boolean().default(false),
  layout: z.enum(["wide", "long"]).default("wide"),
  includeFreeText: z.boolean().default(false),
  /**
   * Identifiers are included by default: participant codes, study codes,
   * sitting and device ids and exact times, for linkage. `deidentified`
   * replaces participant codes with export-specific labels, drops study codes
   * and device ids, and truncates times to the day.
   */
  includeStudyCode: z.boolean().default(true),
  deidentified: z.boolean().default(false),
  /** Release for a question-level summary. */
  versionHash: z.string().max(80).optional(),
  /** A school report: the school (site code), optionally one year group, and which sittings stand for each pupil. */
  school: z.string().regex(/^[A-Z]{2,12}$/).optional(),
  yearGroup: z.number().int().min(1).max(13).nullable().optional(),
  observation: z.enum(OBSERVATIONS).default("latest"),
  /** Search text is never accepted for exports: exports are reproducible from filters alone. */
});

export type ExportSpecInput = z.input<typeof exportSpecSchema>;

export interface ExportSpec {
  kind: ExportKind;
  format: ExportFormat;
  scope: ExportScope;
  sessionIds: string[];
  filters: FilterState;
  sort: SortState;
  includeAnswers: boolean;
  layout: "wide" | "long";
  includeFreeText: boolean;
  includeStudyCode: boolean;
  deidentified: boolean;
  versionHash?: string;
  school?: string;
  yearGroup?: number | null;
  observation: Observation;
}

export class ExportSpecError extends Error {}

export function parseExportSpec(raw: unknown): ExportSpec {
  const parsed = exportSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ExportSpecError(`invalid export request: ${i?.path.join(".") ?? ""} ${i?.message ?? ""}`.trim());
  }
  const d = parsed.data;
  if (!FORMATS_BY_KIND[d.kind].includes(d.format)) {
    throw new ExportSpecError(`${EXPORT_KIND_LABELS[d.kind]} cannot be exported as ${d.format.toUpperCase()}`);
  }
  if ((d.scope === "selected" || d.scope === "single") && d.sessionIds.length === 0) {
    throw new ExportSpecError("no sessions were selected");
  }
  if (d.scope === "single" && d.sessionIds.length !== 1) throw new ExportSpecError("a single-session export names exactly one session");
  if (d.kind === "session_report" && d.scope !== "single") throw new ExportSpecError("a formatted report covers one session");
  if (d.kind === "question_summary" && !d.versionHash) throw new ExportSpecError("choose the survey version for a question-level summary");
  if (d.kind === "school_report" && !d.school) throw new ExportSpecError("choose the school the report is for");
  if (d.kind === "school_report" && (d.scope === "selected" || d.scope === "single")) throw new ExportSpecError("a school report covers the filtered sittings, not chosen ones");
  const spec: ExportSpec = {
    kind: d.kind,
    format: d.format,
    scope: d.scope,
    sessionIds: [...new Set(d.sessionIds)],
    filters: sanitiseFilters(d.filters),
    sort: sanitiseSort(d.sort),
    // A BIDS dataset is the answers; it has no "session fields only" form.
    includeAnswers: d.kind === "sessions" ? d.includeAnswers || d.format === "bids" : d.kind === "session_report",
    layout: d.layout,
    includeFreeText: d.includeFreeText && (d.kind === "sessions" ? d.includeAnswers || d.format === "bids" : d.kind === "session_report"),
    // Identifiers only exist in session-level exports; a summary never carries them.
    includeStudyCode: d.includeStudyCode && !d.deidentified && (d.kind === "sessions" || d.kind === "session_report"),
    deidentified: d.deidentified,
    ...(d.versionHash ? { versionHash: d.versionHash } : {}),
    ...(d.kind === "school_report" && d.school ? { school: d.school, yearGroup: d.yearGroup ?? null } : {}),
    observation: d.observation,
  };
  if (spec.scope === "all") spec.filters = { ...spec.filters, datePreset: "all", statuses: [], versions: [], sites: [], sources: [], flagged: "any", reviewStatuses: [], questionOutcomes: [] };
  return spec;
}

/** Row-level data (one row per sitting or per answer) is sensitive; aggregates are not. */
export function isSensitive(spec: ExportSpec): boolean {
  return spec.kind === "sessions" || spec.kind === "session_report";
}

export function authoriseExport(
  role: Role | null,
  spec: ExportSpec,
  policy: { reviewerCanViewFreeText?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!can(role, "view.dashboard")) return { ok: false, reason: "your account has no dashboard role" };
  if (isSensitive(spec)) {
    if (!can(role, "export.sessions")) return { ok: false, reason: "your role may export summaries, not session-level data" };
  } else if (!can(role, "export.aggregate")) {
    return { ok: false, reason: "your role may not export" };
  }
  if (spec.includeFreeText && !can(role, "export.freeText")) return { ok: false, reason: "your role may not export free-text answers" };
  if (spec.includeStudyCode && !can(role, "export.studyCode")) return { ok: false, reason: "your role may not export study codes" };
  if (spec.format === "json" && !can(role, "export.json")) return { ok: false, reason: "JSON exports are for administrators" };
  void policy;
  return { ok: true };
}

const stamp = (d: Date) => {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
};

/**
 * `myself_sessions-filtered_2026-09-01_to_2026-09-28_created-20260928-1415.csv`
 *
 * Only [a-z0-9._-]: safe on every file system and in a Content-Disposition header.
 */
export function exportFileName(
  spec: Pick<ExportSpec, "kind" | "scope" | "format" | "sessionIds" | "deidentified"> & Partial<Pick<ExportSpec, "school" | "yearGroup">>,
  range: { fromDay: string | null; toDay: string | null },
  createdAt: Date,
): string {
  const kind = spec.kind.replaceAll("_", "-") + (spec.kind === "school_report" && spec.school ? `-${spec.school.toLowerCase()}${spec.yearGroup ? `-y${spec.yearGroup}` : ""}` : "");
  const scope = spec.kind === "sessions" ? `-${spec.scope}` : "";
  const what =
    spec.scope === "single"
      ? `session-${(spec.sessionIds[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32)}`
      : range.fromDay || range.toDay
        ? `${range.fromDay ?? "start"}_to_${range.toDay ?? "now"}`
        : "all-time";
  const deid = spec.deidentified && spec.kind === "sessions" ? "_deidentified" : "";
  const bids = spec.format === "bids" ? "_bids" : "";
  return `myself_${kind}${scope}_${what}${bids}${deid}_created-${stamp(createdAt)}.${FORMAT_EXTENSION[spec.format]}`.replace(/[^a-z0-9._-]/g, "");
}
