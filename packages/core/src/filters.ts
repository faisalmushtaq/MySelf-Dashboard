import { DATE_PRESETS, inRange, resolveRange, type DatePreset, type ResolvedRange } from "./dates.js";
import { OUTCOMES, type Outcome } from "./completeness.js";
import { REVIEW_STATUSES, type ReviewStatus } from "./review.js";
import { DISPLAY_STATUSES, matchesStatus, type DerivedStatus, type DisplayStatus } from "./status.js";
import { outcomeOf, type SessionSummary } from "./summary.js";
import type { ReviewDoc } from "./review.js";
import { isSurveyId } from "./vendor/myself/schema/link.js";

/**
 * The global filter model: one shape for the URL, saved views, the backend
 * query and exports, so "what I was looking at" is the same thing everywhere.
 *
 * FREE-TEXT SEARCH IS NOT PART OF IT on purpose. A search is how somebody finds a
 * study code, and a study code in a URL ends up in browser history, proxy logs
 * and chat messages. The search box is kept in session storage instead.
 */

export const DATE_BASES = ["started", "completed", "last_activity", "received"] as const;
export type DateBasis = (typeof DATE_BASES)[number];

export const DATE_BASIS_LABELS: Record<DateBasis, string> = {
  started: "Session start (device clock)",
  completed: "Completion (device clock)",
  last_activity: "Last activity (device clock)",
  received: "First received (server clock)",
};

export const DATASETS = ["production", "test", "all"] as const;
export type Dataset = (typeof DATASETS)[number];
export const DATASET_LABELS: Record<Dataset, string> = {
  production: "Production only",
  test: "Test sessions only",
  all: "Production and test",
};

export const FLAG_FILTERS = ["any", "flagged", "unflagged"] as const;
export type FlagFilter = (typeof FLAG_FILTERS)[number];

export const UNKNOWN_VERSION = "unknown";

export interface FilterState {
  datePreset: DatePreset;
  from?: string;
  to?: string;
  dateBasis: DateBasis;
  statuses: DisplayStatus[];
  completionMin?: number;
  completionMax?: number;
  /**
   * Surveys of the study (Studio survey ids). A sitting's survey is its release's
   * `release.assessment` (docs/12 §12.6); a sitting whose version is not
   * registered belongs to none, so a survey filter leaves it out.
   */
  surveys: string[];
  /** Release hashes; `unknown` matches sittings whose version is not in the registry. */
  versions: string[];
  sites: string[];
  sources: string[];
  flagged: FlagFilter;
  dataset: Dataset;
  reviewStatuses: ReviewStatus[];
  /** Sittings where this question had one of `questionOutcomes`. */
  questionKey?: string;
  questionOutcomes: (Outcome | "not_in_version")[];
  /** Sittings missing this required question. */
  missingKey?: string;
  /** Unfinished sittings whose last shown question was this one. */
  dropOffKey?: string;
  /** Unfinished sittings that stopped in this section. */
  dropOffSection?: string;
  /** Sittings where this section applied and has missing required answers. */
  sectionIncomplete?: string;
  /** Sittings carrying this data-quality signal. */
  warning?: string;
}

export const DEFAULT_FILTERS: FilterState = {
  datePreset: "all",
  dateBasis: "started",
  statuses: [],
  surveys: [],
  versions: [],
  sites: [],
  sources: [],
  flagged: "any",
  dataset: "production",
  reviewStatuses: [],
  questionOutcomes: [],
};

export const SORT_KEYS = [
  "startedAt",
  "lastActivityAt",
  "completedAt",
  "receivedAt",
  "completion",
  "status",
  "version",
  "studyCode",
  "sessionId",
  "missingRequired",
  "warnings",
  "flags",
  "reviewStatus",
  "lastReviewedAt",
  "duration",
  "section",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}
export const DEFAULT_SORT: SortState = { key: "startedAt", dir: "desc" };

export interface SessionRow {
  summary: SessionSummary;
  review: ReviewDoc | null;
  status: DerivedStatus;
  /** The survey the sitting's release belongs to, when its release is registered (`buildRows`). */
  survey?: string | null;
}

const list = (v: string | null): string[] => (v ? v.split(",").map((s) => decodeURIComponent(s)).filter(Boolean) : []);
const joinList = (xs: readonly string[]) => xs.map((x) => encodeURIComponent(x)).join(",");
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const numberIn = (v: string | null, min: number, max: number): number | undefined => {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const someOf = <T extends string>(v: string | null, allowed: readonly T[]): T[] =>
  list(v).filter((x): x is T => (allowed as readonly string[]).includes(x));
const safeKey = (v: string | null): string | undefined =>
  v && /^[A-Za-z0-9_.\-]{1,160}$/.test(v) ? v : undefined;

/** Filters → URL parameters. Defaults are omitted so shared URLs stay short. */
export function filtersToParams(f: FilterState, params = new URLSearchParams()): URLSearchParams {
  if (f.datePreset !== DEFAULT_FILTERS.datePreset) params.set("d", f.datePreset);
  if (f.datePreset === "custom") {
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
  }
  if (f.dateBasis !== DEFAULT_FILTERS.dateBasis) params.set("basis", f.dateBasis);
  if (f.statuses.length) params.set("st", joinList(f.statuses));
  if (f.completionMin !== undefined) params.set("cmin", String(f.completionMin));
  if (f.completionMax !== undefined) params.set("cmax", String(f.completionMax));
  if (f.surveys.length) params.set("sv", joinList(f.surveys));
  if (f.versions.length) params.set("v", joinList(f.versions));
  if (f.sites.length) params.set("site", joinList(f.sites));
  if (f.sources.length) params.set("src", joinList(f.sources));
  if (f.flagged !== "any") params.set("fl", f.flagged);
  if (f.dataset !== DEFAULT_FILTERS.dataset) params.set("ds", f.dataset);
  if (f.reviewStatuses.length) params.set("rs", joinList(f.reviewStatuses));
  if (f.questionKey) params.set("q", f.questionKey);
  if (f.questionOutcomes.length) params.set("qo", joinList(f.questionOutcomes));
  if (f.missingKey) params.set("miss", f.missingKey);
  if (f.dropOffKey) params.set("drop", f.dropOffKey);
  if (f.dropOffSection) params.set("dsec", f.dropOffSection);
  if (f.sectionIncomplete) params.set("sinc", f.sectionIncomplete);
  if (f.warning) params.set("w", f.warning);
  return params;
}

/** URL parameters → filters. Anything unrecognised is dropped, never trusted. */
export function filtersFromParams(p: URLSearchParams): FilterState {
  const f: FilterState = {
    ...DEFAULT_FILTERS,
    datePreset: oneOf(p.get("d"), DATE_PRESETS, DEFAULT_FILTERS.datePreset),
    dateBasis: oneOf(p.get("basis"), DATE_BASES, DEFAULT_FILTERS.dateBasis),
    statuses: someOf(p.get("st"), DISPLAY_STATUSES),
    surveys: list(p.get("sv")).filter(isSurveyId),
    versions: list(p.get("v")).filter((v) => v === UNKNOWN_VERSION || /^sha256:[0-9a-f]{64}$/.test(v)),
    sites: list(p.get("site")).filter((s) => /^[A-Za-z]{1,10}$/.test(s)).map((s) => s.toUpperCase()),
    sources: list(p.get("src")).filter((s) => /^[a-z_]{1,20}$/.test(s)),
    flagged: oneOf(p.get("fl"), FLAG_FILTERS, "any"),
    dataset: oneOf(p.get("ds"), DATASETS, DEFAULT_FILTERS.dataset),
    reviewStatuses: someOf(p.get("rs"), REVIEW_STATUSES),
    questionOutcomes: someOf(p.get("qo"), [...OUTCOMES, "not_in_version"] as const),
  };
  if (f.datePreset === "custom") {
    const from = p.get("from");
    const to = p.get("to");
    if (isDay(from)) f.from = from;
    if (isDay(to)) f.to = to;
  }
  const cmin = numberIn(p.get("cmin"), 0, 100);
  const cmax = numberIn(p.get("cmax"), 0, 100);
  if (cmin !== undefined) f.completionMin = cmin;
  if (cmax !== undefined) f.completionMax = cmax;
  const q = safeKey(p.get("q"));
  if (q) f.questionKey = q;
  const miss = safeKey(p.get("miss"));
  if (miss) f.missingKey = miss;
  const drop = safeKey(p.get("drop"));
  if (drop) f.dropOffKey = drop;
  const dsec = safeKey(p.get("dsec"));
  if (dsec) f.dropOffSection = dsec;
  const sinc = safeKey(p.get("sinc"));
  if (sinc) f.sectionIncomplete = sinc;
  const w = safeKey(p.get("w"));
  if (w) f.warning = w;
  return f;
}

export function sortToParams(s: SortState, params = new URLSearchParams()): URLSearchParams {
  if (s.key !== DEFAULT_SORT.key) params.set("sort", s.key);
  if (s.dir !== DEFAULT_SORT.dir) params.set("dir", s.dir);
  return params;
}

export function sortFromParams(p: URLSearchParams): SortState {
  return {
    key: oneOf(p.get("sort"), SORT_KEYS, DEFAULT_SORT.key),
    dir: p.get("dir") === "asc" ? "asc" : p.get("dir") === "desc" ? "desc" : DEFAULT_SORT.dir,
  };
}

/** Parse filters that arrived from a client (callable payload), refusing anything odd. */
export function sanitiseFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FILTERS };
  const r = raw as Record<string, unknown>;
  const p = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (typeof v === "string") p.set(k, v);
    else if (typeof v === "number" && Number.isFinite(v)) p.set(k, String(v));
    else if (Array.isArray(v)) p.set(k, joinList(v.filter((x): x is string => typeof x === "string").slice(0, 100)));
  };
  put("d", r["datePreset"]);
  put("from", r["from"]);
  put("to", r["to"]);
  put("basis", r["dateBasis"]);
  put("st", r["statuses"]);
  put("cmin", r["completionMin"]);
  put("cmax", r["completionMax"]);
  put("sv", r["surveys"]);
  put("v", r["versions"]);
  put("site", r["sites"]);
  put("src", r["sources"]);
  put("fl", r["flagged"]);
  put("ds", r["dataset"]);
  put("rs", r["reviewStatuses"]);
  put("q", r["questionKey"]);
  put("qo", r["questionOutcomes"]);
  put("miss", r["missingKey"]);
  put("drop", r["dropOffKey"]);
  put("dsec", r["dropOffSection"]);
  put("sinc", r["sectionIncomplete"]);
  put("w", r["warning"]);
  return filtersFromParams(p);
}

export function sanitiseSort(raw: unknown): SortState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SORT };
  const r = raw as Record<string, unknown>;
  const p = new URLSearchParams();
  if (typeof r["key"] === "string") p.set("sort", r["key"]);
  if (typeof r["dir"] === "string") p.set("dir", r["dir"]);
  return sortFromParams(p);
}

/** Which timestamp a date filter reads. */
export function dateFor(summary: SessionSummary, basis: DateBasis): string | null {
  switch (basis) {
    case "completed":
      return summary.completedAt;
    case "last_activity":
      return summary.lastActivityAt;
    case "received":
      return summary.firstReceivedAt;
    case "started":
    default:
      return summary.startedAt;
  }
}

export interface FilterContext {
  now: Date;
  timeZone: string;
}

export function rangeFor(f: FilterState, ctx: FilterContext): ResolvedRange {
  return resolveRange(f.datePreset, { from: f.from, to: f.to }, ctx.now, ctx.timeZone);
}

/**
 * Build a predicate for the filter state. Every clause is ANDed; values within
 * one clause (e.g. two statuses) are ORed.
 */
export function makePredicate(f: FilterState, ctx: FilterContext, options: { ignoreDate?: boolean } = {}): (row: SessionRow) => boolean {
  const range = rangeFor(f, ctx);
  const surveys = new Set(f.surveys);
  const versions = new Set(f.versions);
  const sites = new Set(f.sites);
  const sources = new Set(f.sources);
  const reviewStatuses = new Set(f.reviewStatuses);
  const outcomes = new Set<string>(f.questionOutcomes);
  const hasCompletionRange = f.completionMin !== undefined || f.completionMax !== undefined;
  const cmin = f.completionMin ?? 0;
  const cmax = f.completionMax ?? 100;

  return (row) => {
    const s = row.summary;
    const st = row.status;
    if (!options.ignoreDate && !inRange(dateFor(s, f.dateBasis), range)) return false;
    if (f.dataset === "production" && st.markers.includes("test")) return false;
    if (f.dataset === "test" && !st.markers.includes("test")) return false;
    if (f.statuses.length && !f.statuses.some((w) => matchesStatus(st, w))) return false;
    if (hasCompletionRange) {
      if (s.requiredCompletion === null) return false;
      const pct = s.requiredCompletion * 100;
      if (pct < cmin - 1e-9 || pct > cmax + 1e-9) return false;
    }
    if (surveys.size && !(row.survey && surveys.has(row.survey))) return false;
    if (versions.size) {
      const v = s.releaseKnown && s.releaseHash ? s.releaseHash : UNKNOWN_VERSION;
      if (!versions.has(v)) return false;
    }
    if (sites.size && !(s.site && sites.has(s.site))) return false;
    if (sources.size && !(s.provenance && sources.has(s.provenance))) return false;
    if (f.flagged === "flagged" && st.openFlags === 0) return false;
    if (f.flagged === "unflagged" && st.openFlags > 0) return false;
    if (reviewStatuses.size && !reviewStatuses.has(row.review?.status ?? "unreviewed")) return false;
    if (f.questionKey) {
      const entry = s.items.find((i) => i.k === f.questionKey);
      const outcome = entry ? outcomeOf(entry) : s.releaseKnown ? "not_in_version" : null;
      if (outcomes.size) {
        if (outcome === null || !outcomes.has(outcome)) return false;
      } else if (!entry) return false;
    }
    if (f.missingKey && !s.missingRequiredKeys.includes(f.missingKey)) return false;
    if (f.dropOffKey && (s.terminal || s.lastPresentedKey !== f.dropOffKey)) return false;
    if (f.dropOffSection && (s.terminal || s.finalSectionKey !== f.dropOffSection)) return false;
    if (f.sectionIncomplete) {
      const sec = s.sections.find((x) => x.key === f.sectionIncomplete);
      if (!sec || !sec.applicable || sec.resolved >= sec.required) return false;
    }
    if (f.warning && !st.signals.includes(f.warning)) return false;
    return true;
  };
}

/** Human-readable list of active filters, for chips, export previews and audit rows. */
export function describeFilters(
  f: FilterState,
  labels: { version?: (hash: string) => string; survey?: (id: string) => string; question?: (key: string) => string; section?: (key: string) => string } = {},
): { key: keyof FilterState | "date"; label: string }[] {
  const out: { key: keyof FilterState | "date"; label: string }[] = [];
  if (f.datePreset !== "all") {
    const range = f.datePreset === "custom" ? `${f.from ?? "…"} to ${f.to ?? "…"}` : f.datePreset;
    out.push({ key: "date", label: `Date (${f.dateBasis.replace("_", " ")}): ${range}` });
  }
  if (f.statuses.length) out.push({ key: "statuses", label: `Status: ${f.statuses.join(", ").replaceAll("_", " ")}` });
  if (f.completionMin !== undefined || f.completionMax !== undefined) {
    out.push({ key: "completionMin", label: `Completion ${f.completionMin ?? 0}–${f.completionMax ?? 100}%` });
  }
  if (f.surveys.length) out.push({ key: "surveys", label: `Survey: ${f.surveys.map((v) => labels.survey?.(v) ?? v).join(", ")}` });
  if (f.versions.length) out.push({ key: "versions", label: `Version: ${f.versions.map((v) => labels.version?.(v) ?? v.slice(7, 19)).join(", ")}` });
  if (f.sites.length) out.push({ key: "sites", label: `Site: ${f.sites.join(", ")}` });
  if (f.sources.length) out.push({ key: "sources", label: `Source: ${f.sources.join(", ")}` });
  if (f.flagged !== "any") out.push({ key: "flagged", label: f.flagged === "flagged" ? "Flagged" : "Not flagged" });
  if (f.dataset !== "production") out.push({ key: "dataset", label: DATASET_LABELS[f.dataset] });
  if (f.reviewStatuses.length) out.push({ key: "reviewStatuses", label: `Review: ${f.reviewStatuses.join(", ").replaceAll("_", " ")}` });
  if (f.questionKey) {
    const q = labels.question?.(f.questionKey) ?? f.questionKey;
    out.push({ key: "questionKey", label: f.questionOutcomes.length ? `${q}: ${f.questionOutcomes.join(", ").replaceAll("_", " ")}` : `Has ${q}` });
  }
  if (f.missingKey) out.push({ key: "missingKey", label: `Missing ${labels.question?.(f.missingKey) ?? f.missingKey}` });
  if (f.dropOffKey) out.push({ key: "dropOffKey", label: `Stopped at ${labels.question?.(f.dropOffKey) ?? f.dropOffKey}` });
  if (f.dropOffSection) out.push({ key: "dropOffSection", label: `Stopped in ${labels.section?.(f.dropOffSection) ?? f.dropOffSection}` });
  if (f.sectionIncomplete) out.push({ key: "sectionIncomplete", label: `Incomplete section: ${labels.section?.(f.sectionIncomplete) ?? f.sectionIncomplete}` });
  if (f.warning) out.push({ key: "warning", label: `Signal: ${f.warning.replaceAll("_", " ")}` });
  return out;
}

/** Remove one clause, as the "×" on a filter chip does. */
export function clearFilter(f: FilterState, key: keyof FilterState | "date"): FilterState {
  const next: FilterState = { ...f };
  switch (key) {
    case "date":
      next.datePreset = "all";
      delete next.from;
      delete next.to;
      break;
    case "completionMin":
    case "completionMax":
      delete next.completionMin;
      delete next.completionMax;
      break;
    case "questionKey":
    case "questionOutcomes":
      delete next.questionKey;
      next.questionOutcomes = [];
      break;
    case "dataset":
      next.dataset = DEFAULT_FILTERS.dataset;
      break;
    case "flagged":
      next.flagged = "any";
      break;
    default: {
      const k = key as keyof FilterState;
      const d = DEFAULT_FILTERS[k];
      if (d === undefined) delete (next as unknown as Record<string, unknown>)[k];
      else (next as unknown as Record<string, unknown>)[k] = Array.isArray(d) ? [] : d;
    }
  }
  return next;
}
