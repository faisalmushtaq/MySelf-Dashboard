import { z } from "zod";
import { can, type Role } from "./roles.js";
import { sanitiseFilters, sanitiseSort, type FilterState, type SortState } from "./filters.js";

/**
 * What an export may contain, who may ask for it, and what it is called.
 * Checked on the SERVER against the caller's role for every export; the dialog
 * in the browser shows the same decisions but does not make them.
 */

export const EXPORT_KINDS = ["sessions", "session_report", "completeness_summary", "question_summary"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  sessions: "Session data",
  session_report: "Formatted session report",
  completeness_summary: "Completeness summary",
  question_summary: "Question-level summary",
};

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMATS_BY_KIND: Record<ExportKind, readonly ExportFormat[]> = {
  sessions: ["csv", "xlsx", "json"],
  session_report: ["pdf"],
  completeness_summary: ["csv", "xlsx", "pdf"],
  question_summary: ["csv", "xlsx"],
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
  includeStudyCode: z.boolean().default(false),
  /** Drop study codes and device ids, and truncate timestamps to the day. */
  deidentified: z.boolean().default(true),
  /** Release for a question-level summary. */
  versionHash: z.string().max(80).optional(),
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
  const spec: ExportSpec = {
    kind: d.kind,
    format: d.format,
    scope: d.scope,
    sessionIds: [...new Set(d.sessionIds)],
    filters: sanitiseFilters(d.filters),
    sort: sanitiseSort(d.sort),
    includeAnswers: d.kind === "sessions" ? d.includeAnswers : d.kind === "session_report",
    layout: d.layout,
    includeFreeText: d.includeFreeText && (d.kind === "sessions" ? d.includeAnswers : d.kind === "session_report"),
    includeStudyCode: d.includeStudyCode && !d.deidentified,
    deidentified: d.deidentified,
    ...(d.versionHash ? { versionHash: d.versionHash } : {}),
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
  spec: Pick<ExportSpec, "kind" | "scope" | "format" | "sessionIds" | "deidentified">,
  range: { fromDay: string | null; toDay: string | null },
  createdAt: Date,
): string {
  const kind = spec.kind.replaceAll("_", "-");
  const scope = spec.kind === "sessions" ? `-${spec.scope}` : "";
  const what =
    spec.scope === "single"
      ? `session-${(spec.sessionIds[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32)}`
      : range.fromDay || range.toDay
        ? `${range.fromDay ?? "start"}_to_${range.toDay ?? "now"}`
        : "all-time";
  const deid = spec.deidentified && spec.kind === "sessions" ? "_deidentified" : "";
  return `myself_${kind}${scope}_${what}${deid}_created-${stamp(createdAt)}.${spec.format}`.replace(/[^a-z0-9._-]/g, "");
}
