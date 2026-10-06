import type { Policy } from "./policy.js";
import type { ReviewDoc } from "./review.js";
import { deriveStatus, LIFECYCLES, MARKERS } from "./status.js";
import type { SessionSummary } from "./summary.js";
import { makePredicate, type FilterContext, type FilterState, type SessionRow, type SortState } from "./filters.js";

/**
 * The session list: filter, search, sort, page and find neighbours.
 *
 * Runs server-side over the in-memory summary set (docs/02 §2.4). Previous/Next
 * in the session view come from the same ordering, so they always follow the
 * filtered, sorted list the researcher was looking at.
 */

export function buildRows(
  summaries: Iterable<SessionSummary>,
  reviews: ReadonlyMap<string, ReviewDoc>,
  policy: Policy,
  now: Date,
  options: { surveyOf?: (releaseHash: string) => string | null | undefined } = {},
): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const summary of summaries) {
    const review = reviews.get(summary.sessionId) ?? null;
    // A sitting's survey is its release's, so a sitting under an unregistered version has none (docs/12 §12.6).
    const survey = summary.releaseKnown && summary.releaseHash ? (options.surveyOf?.(summary.releaseHash) ?? null) : null;
    rows.push({ summary, review, status: deriveStatus(summary, review, policy, now), survey });
  }
  return rows;
}

const STATUS_ORDER = new Map<string, number>([...MARKERS, ...LIFECYCLES].map((s, i) => [s, i]));

type Comparable = string | number | null;

function sortValue(row: SessionRow, key: SortState["key"]): Comparable {
  const s = row.summary;
  switch (key) {
    case "startedAt":
      return s.startedAt;
    case "lastActivityAt":
      return s.lastActivityAt;
    case "completedAt":
      return s.completedAt;
    case "receivedAt":
      return s.receivedAt;
    case "completion":
      return s.requiredCompletion;
    case "status":
      return STATUS_ORDER.get(row.status.display) ?? 99;
    case "version":
      return s.releaseVersion;
    case "studyCode":
      return s.studyCode;
    case "sessionId":
      return s.sessionId;
    case "missingRequired":
      return s.releaseKnown ? s.counts.requiredMissing : null;
    case "warnings":
      return row.status.signals.length;
    case "flags":
      return row.status.openFlags;
    case "reviewStatus":
      return row.review?.status ?? "unreviewed";
    case "lastReviewedAt":
      return row.review?.lastReviewedAt ?? null;
    case "duration":
      return s.durationMs ?? s.wallClockMs;
    case "section":
      return s.finalSectionKey;
  }
}

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/** Nulls always last, whichever the direction; session id breaks ties so order is stable. */
export function compareRows(a: SessionRow, b: SessionRow, sort: SortState): number {
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  if (va === null && vb !== null) return 1;
  if (vb === null && va !== null) return -1;
  let c = 0;
  if (va !== null && vb !== null) {
    c = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
  }
  if (sort.dir === "desc") c = -c;
  return c !== 0 ? c : a.summary.sessionId.localeCompare(b.summary.sessionId);
}

export interface SearchOptions {
  /** Whether the caller may search (and therefore see) study codes. */
  studyCodes: boolean;
}

/**
 * Search by session id, or by study code where the role may see codes. A
 * reviewer searching for a code finds nothing rather than learning which codes
 * exist.
 */
export function matchesSearch(row: SessionRow, search: string, options: SearchOptions): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if (row.summary.sessionId.toLowerCase().includes(q)) return true;
  if (options.studyCodes && row.summary.studyCode?.toLowerCase().includes(q)) return true;
  return false;
}

export interface QueryInput {
  filters: FilterState;
  search: string;
  sort: SortState;
  page: number;
  pageSize: number;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export function orderedRows(rows: SessionRow[], input: Omit<QueryInput, "page" | "pageSize">, ctx: FilterContext, search: SearchOptions): SessionRow[] {
  const pred = makePredicate(input.filters, ctx);
  return rows
    .filter((r) => pred(r) && matchesSearch(r, input.search, search))
    .sort((a, b) => compareRows(a, b, input.sort));
}

export interface QueryResult {
  rows: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function runQuery(rows: SessionRow[], input: QueryInput, ctx: FilterContext, search: SearchOptions): QueryResult {
  const ordered = orderedRows(rows, input, ctx, search);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(input.pageSize) ? input.pageSize : 50;
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pageCount);
  return {
    rows: ordered.slice((page - 1) * pageSize, page * pageSize),
    total: ordered.length,
    page,
    pageSize,
    pageCount,
  };
}

export interface Neighbours {
  /** 1-based position in the filtered, sorted list; null when the sitting is not in it. */
  position: number | null;
  total: number;
  previousId: string | null;
  nextId: string | null;
  firstId: string | null;
  lastId: string | null;
  nextFlaggedId: string | null;
  previousFlaggedId: string | null;
  /** The page of the list this sitting is on, for "back to results". */
  page: number | null;
}

export function neighbours(ordered: SessionRow[], sessionId: string, pageSize = 50): Neighbours {
  const i = ordered.findIndex((r) => r.summary.sessionId === sessionId);
  const flagged = (r: SessionRow) => r.status.openFlags > 0 || r.status.markers.includes("needs_review");
  let nextFlaggedId: string | null = null;
  let previousFlaggedId: string | null = null;
  if (i >= 0) {
    for (let j = i + 1; j < ordered.length; j += 1) if (flagged(ordered[j]!)) { nextFlaggedId = ordered[j]!.summary.sessionId; break; }
    for (let j = i - 1; j >= 0; j -= 1) if (flagged(ordered[j]!)) { previousFlaggedId = ordered[j]!.summary.sessionId; break; }
  }
  return {
    position: i >= 0 ? i + 1 : null,
    total: ordered.length,
    previousId: i > 0 ? ordered[i - 1]!.summary.sessionId : null,
    nextId: i >= 0 && i < ordered.length - 1 ? ordered[i + 1]!.summary.sessionId : null,
    firstId: ordered[0]?.summary.sessionId ?? null,
    lastId: ordered[ordered.length - 1]?.summary.sessionId ?? null,
    nextFlaggedId,
    previousFlaggedId,
    page: i >= 0 ? Math.floor(i / pageSize) + 1 : null,
  };
}

/** The sitting at a 1-based position ("jump to session 40 of 84"). */
export function idAtPosition(ordered: SessionRow[], position: number): string | null {
  return ordered[Math.floor(position) - 1]?.summary.sessionId ?? null;
}
