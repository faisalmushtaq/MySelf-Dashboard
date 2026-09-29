import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  clearFilter,
  DEFAULT_FILTERS,
  filtersFromParams,
  filtersToParams,
  sortFromParams,
  sortToParams,
  type FilterState,
  type SortState,
} from "@myself-dashboard/core";

/**
 * Filters live in the URL, so a view can be bookmarked or shared and the Back
 * button works. Search text never does (see core/filters.ts) — it is kept in
 * session storage by the pages that use it.
 */

/** URL keys owned by the filter model; everything else on a URL is page state. */
const FILTER_KEYS = ["d", "from", "to", "basis", "st", "cmin", "cmax", "v", "site", "src", "fl", "ds", "rs", "q", "qo", "miss", "drop", "dsec", "sinc", "w"];

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const sort = useMemo(() => sortFromParams(params), [params]);

  const write = useCallback(
    (next: FilterState, extra: Record<string, string | null> = {}, resetPage = true) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of FILTER_KEYS) p.delete(k);
          filtersToParams(next, p);
          if (resetPage) p.delete("page");
          for (const [k, v] of Object.entries(extra)) {
            if (v === null) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  return {
    filters,
    sort,
    params,
    setParams,
    update: (patch: Partial<FilterState>) => write({ ...filters, ...patch }),
    replace: (next: FilterState) => write(next),
    clear: (key: Parameters<typeof clearFilter>[1]) => write(clearFilter(filters, key)),
    reset: () => write({ ...DEFAULT_FILTERS }),
    setSort: (s: SortState) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.delete("sort");
        p.delete("dir");
        sortToParams(s, p);
        p.delete("page");
        return p;
      }),
    setPage: (page: number) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (page <= 1) p.delete("page");
        else p.set("page", String(page));
        return p;
      }),
  };
}

/** The filter part of the current URL, to carry between filter-scoped pages. */
export function filterQuery(params: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v !== null) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A link to the session list for a metric or chart mark, keeping the current filters. */
export function sessionsLink(base: FilterState, patch: Partial<FilterState>): string {
  const p = filtersToParams({ ...base, ...patch });
  const s = p.toString();
  return `/sessions${s ? `?${s}` : ""}`;
}
