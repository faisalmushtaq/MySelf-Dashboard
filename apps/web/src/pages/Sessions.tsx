import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import {
  FLAG_REASONS,
  PAGE_SIZES,
  REVIEW_STATUS_LABELS,
  WARNING_LABELS,
  type QuerySessionsResponse,
  type SessionListItem,
  type SortKey,
} from "@myself-dashboard/core";
import { api } from "../lib/api";
import { useDebounced, useLoad, usePreference, useSessionState } from "../lib/hooks";
import { dateTime, duration, int, pct, shortId } from "../lib/format";
import { firebase, STUDY } from "../lib/firebase";
import { useFilters } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { useStudyData } from "../app/data";
import { PageHeader } from "../components/Metric";
import { StatusBadge } from "../components/Status";
import { Icon } from "../components/Icon";
import { Popover } from "../components/Popover";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/States";
import { ExportDialog } from "../components/ExportDialog";
import { Dialog } from "../components/Dialog";
import { SessionDetail } from "../components/SessionDetail";

interface Column {
  id: string;
  label: string;
  sort?: SortKey;
  numeric?: boolean;
  render: (s: SessionListItem, ctx: { versionLabel: (h: string) => string }) => ReactNode;
}

const COLUMNS: Column[] = [
  { id: "session", label: "Session ID", sort: "sessionId", render: (s) => <code title={s.sessionId}>{shortId(s.sessionId)}</code> },
  { id: "code", label: "Study code", sort: "studyCode", render: (s) => (s.studyCode ? <span title={s.studyCodeMasked ? "Partly hidden for your role" : undefined}>{s.studyCode}</span> : "—") },
  { id: "started", label: "Started", sort: "startedAt", render: (s) => dateTime(s.startedAt) },
  { id: "last", label: "Last activity", sort: "lastActivityAt", render: (s) => dateTime(s.lastActivityAt) },
  { id: "completed", label: "Completed", sort: "completedAt", render: (s) => (s.completedAt ? dateTime(s.completedAt) : "—") },
  { id: "version", label: "Version", sort: "version", render: (s, c) => (s.releaseKnown && s.releaseHash ? c.versionLabel(s.releaseHash) : <span title={s.releaseHash ?? ""}>Unknown</span>) },
  {
    id: "completion",
    label: "Completion",
    sort: "completion",
    numeric: true,
    render: (s) =>
      s.requiredCompletion === null ? (
        <span className="muted">n/a</span>
      ) : (
        <span className="completion-cell" title={s.estimated ? "Estimated" : undefined}>
          <span className="mini-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(s.requiredCompletion * 100)}%` }} />
          </span>
          {pct(s.requiredCompletion, s.estimated)}
        </span>
      ),
  },
  { id: "section", label: "Current / final section", sort: "section", render: (s) => s.finalSectionTitle ?? s.finalSectionKey ?? "—" },
  { id: "status", label: "Status", sort: "status", render: (s) => <StatusBadge status={s.status} /> },
  { id: "missing", label: "Missing required", sort: "missingRequired", numeric: true, render: (s) => (s.requiredMissing === null ? "—" : int(s.requiredMissing)) },
  {
    id: "signals",
    label: "Validation warnings",
    sort: "warnings",
    render: (s) => {
      const important = s.status.signals.filter((w) => !["imported", "backfilled", "resumed", "no_presentation_events"].includes(w));
      return important.length ? <span title={important.map((w) => WARNING_LABELS[w] ?? w).join("\n")}>{important.length} <Icon name="alert" size={13} /></span> : "—";
    },
  },
  {
    id: "flags",
    label: "Review flags",
    sort: "flags",
    render: (s) =>
      s.status.openFlags ? (
        <span title={s.flagReasons.map((r) => FLAG_REASONS.find((f) => f.id === r)?.label ?? r).join(", ")}>
          <Icon name="flag" size={13} /> {s.status.openFlags}
        </span>
      ) : (
        "—"
      ),
  },
  { id: "review", label: "Review status", sort: "reviewStatus", render: (s) => REVIEW_STATUS_LABELS[s.reviewStatus] },
  { id: "reviewed", label: "Last reviewed", sort: "lastReviewedAt", render: (s) => dateTime(s.lastReviewedAt) },
  { id: "duration", label: "Duration", sort: "duration", numeric: true, render: (s) => duration(s.durationMs ?? s.wallClockMs) },
  { id: "received", label: "Last received", sort: "receivedAt", render: (s) => dateTime(s.receivedAt) },
];

const DEFAULT_COLS = ["session", "code", "started", "version", "completion", "section", "status", "missing", "signals", "flags", "review"];

export default function Sessions() {
  const { filters, sort, params, setParams, setSort, setPage } = useFilters();
  const { can, me } = useAuth();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const location = useLocation();
  const { versionLabel, byNewest } = useStudyData();
  const [search, setSearch] = useSessionState("sessions.search", "");
  const debounced = useDebounced(search, 300);
  const [prefCols, setPrefCols] = usePreference<string[]>("sessions.columns", DEFAULT_COLS);
  const [prefDensity, setPrefDensity] = usePreference<"comfortable" | "compact">("sessions.density", "comfortable");
  const [prefSize, setPrefSize] = usePreference<number>("sessions.pageSize", 50);
  const [selected, setSelected] = useSessionState<string[]>("sessions.selected", []);
  const [exportOpen, setExportOpen] = useState<"filtered" | "selected" | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(params.get("size"))) ? Number(params.get("size")) : prefSize;
  const cols = params.get("cols") ? params.get("cols")!.split(",").filter((c) => COLUMNS.some((x) => x.id === c)) : prefCols;
  const density = params.get("dens") === "compact" || params.get("dens") === "comfortable" ? (params.get("dens") as "compact" | "comfortable") : prefDensity;
  const split = params.get("split") === "1";
  const openId = params.get("open");

  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v === null) p.delete(k);
      else p.set(k, v);
      return p;
    });

  const reqKey = JSON.stringify({ filters, sort, debounced, page, pageSize });
  const { data, error, loading, reload } = useLoad<QuerySessionsResponse>(
    () => api.querySessions({ filters, sort, search: debounced, page, pageSize }),
    [reqKey],
  );

  useEffect(() => {
    if (data) announce(`${data.total} session${data.total === 1 ? "" : "s"} match. Page ${data.page} of ${data.pageCount}.`, "info", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.total, data?.page]);

  // ── scroll restoration ────────────────────────────────────────────────────
  const scroller = useRef<HTMLDivElement>(null);
  const scrollKey = `scroll:${location.search.replace(/[?&]open=[^&]*/, "")}`;
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(scrollKey);
      if (raw) {
        const { table, win, focus } = JSON.parse(raw) as { table: number; win: number; focus?: string };
        if (scroller.current) scroller.current.scrollTop = table;
        window.scrollTo(0, win);
        if (focus) {
          const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(focus)}"]`);
          row?.focus({ preventScroll: true });
          row?.scrollIntoView({ block: "nearest" });
        }
      }
    } catch {
      /* ignore */
    }
  }, [data, scrollKey]);

  const rememberScroll = (focusId: string) => {
    try {
      sessionStorage.setItem(scrollKey, JSON.stringify({ table: scroller.current?.scrollTop ?? 0, win: window.scrollY, focus: focusId }));
    } catch {
      /* ignore */
    }
  };

  const openSession = (id: string) => {
    if (split) {
      setParam("open", id);
      return;
    }
    rememberScroll(id);
    const p = new URLSearchParams(params);
    p.delete("open");
    p.delete("split");
    navigate(`/sessions/${encodeURIComponent(id)}?${p.toString()}`);
  };

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    const row = e.currentTarget;
    if (e.key === "Enter") {
      e.preventDefault();
      openSession(id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      (row.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (row.previousElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === " " ) {
      e.preventDefault();
      toggleSelect(id);
    }
  };

  const toggleSelect = useCallback(
    (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 5000)),
    [selected, setSelected],
  );

  void byNewest;

  const visible = COLUMNS.filter((c) => cols.includes(c.id));
  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((i) => selected.includes(i.sessionId));

  const header = (c: Column) => {
    const active = c.sort && sort.key === c.sort;
    const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    return (
      <th key={c.id} scope="col" aria-sort={c.sort ? ariaSort : undefined} className={c.numeric ? "num" : undefined}>
        {c.sort ? (
          <button
            type="button"
            className="th-sort"
            onClick={() => setSort({ key: c.sort!, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
            aria-label={`Sort by ${c.label}${active ? `, currently ${ariaSort}` : ""}`}
          >
            {c.label}
            <Icon name={active ? (sort.dir === "asc" ? "arrowUp" : "arrowDown") : "chevronDown"} size={12} className={active ? "" : "sort-idle"} />
          </button>
        ) : (
          c.label
        )}
      </th>
    );
  };

  const table = (
    <>
      <div className="toolbar" role="toolbar" aria-label="Table options">
        <span className="result-count" aria-live="polite">
          {data ? (
            <>
              <strong>{int(data.total)}</strong> session{data.total === 1 ? "" : "s"}
            </>
          ) : (
            "Loading…"
          )}
        </span>
        <label className="table-search">
          <span className="sr-only">Search in these results</span>
          <Icon name="search" size={15} />
          <input type="search" placeholder={can("view.studyCode") ? "Filter by session ID or study code" : "Filter by session ID"} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Popover label="Columns" button={<><Icon name="columns" size={16} /> Columns</>}>
          {() => (
            <fieldset className="check-list">
              <legend>Visible columns</legend>
              {COLUMNS.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={cols.includes(c.id)}
                    disabled={c.id === "session"}
                    onChange={() => {
                      const next = cols.includes(c.id) ? cols.filter((x) => x !== c.id) : COLUMNS.map((x) => x.id).filter((x) => cols.includes(x) || x === c.id);
                      setPrefCols(next);
                      setParam("cols", next.join(","));
                    }}
                  />
                  {c.label}
                </label>
              ))}
              <button type="button" className="btn-link" onClick={() => { setPrefCols(DEFAULT_COLS); setParam("cols", null); }}>
                Reset columns
              </button>
            </fieldset>
          )}
        </Popover>
        <div className="segmented" role="group" aria-label="Row density">
          {(["comfortable", "compact"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={density === d} onClick={() => { setPrefDensity(d); setParam("dens", d === "comfortable" ? null : d); }}>
              {d === "comfortable" ? "Comfortable" : "Compact"}
            </button>
          ))}
        </div>
        <label className="inline-select">
          Per page
          <select value={pageSize} onChange={(e) => { setPrefSize(Number(e.target.value)); setParams((prev) => { const p = new URLSearchParams(prev); p.set("size", e.target.value); p.delete("page"); return p; }); }}>
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-quiet" aria-pressed={split} onClick={() => setParam("split", split ? null : "1")}>
          <Icon name="split" size={16} /> Split view
        </button>
      </div>
      {selected.length ? (
        <div className="selection-bar" role="status">
          <strong>{int(selected.length)}</strong> selected
          {can("export.sessions") ? (
            <button type="button" className="btn btn-small" onClick={() => setExportOpen("selected")}>
              <Icon name="download" size={14} /> Export selected
            </button>
          ) : null}
          <button type="button" className="btn-link" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      ) : null}
      {error && !data ? <ErrorState title="The session list could not be loaded" message={error.message} onRetry={reload} /> : null}
      {error && data ? <Notice tone="warn">Showing the last results that loaded. {error.message}</Notice> : null}
      {!data && !error ? <Skeleton lines={10} /> : null}
      {data && data.total === 0 ? (
        <EmptyState icon="filter" title={debounced ? "No sessions match this search" : "No sessions match these filters"} action={<button type="button" className="btn" onClick={() => { setSearch(""); navigate("/sessions"); }}>Clear search and filters</button>}>
          {debounced ? `Nothing matches “${debounced}”.` : "Widen the date range or remove a filter."} Test sessions are hidden unless you include them under “Data”.
        </EmptyState>
      ) : null}
      {data && data.total > 0 ? (
        <div className={`table-scroll ${loading ? "dimmed" : ""}`} ref={scroller} aria-busy={loading}>
          <table className={`data sessions-table density-${density}`} aria-rowcount={data.total + 1}>
            <caption className="sr-only">
              Sessions, page {data.page} of {data.pageCount}, sorted by {sort.key} {sort.dir === "asc" ? "ascending" : "descending"}. Use the arrow keys to move between rows and Enter to open one.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <input
                    type="checkbox"
                    aria-label={allOnPage ? "Deselect all sessions on this page" : "Select all sessions on this page"}
                    checked={allOnPage}
                    onChange={() =>
                      setSelected(allOnPage ? selected.filter((id) => !items.some((i) => i.sessionId === id)) : [...new Set([...selected, ...items.map((i) => i.sessionId)])])
                    }
                  />
                </th>
                {visible.map(header)}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr
                  key={s.sessionId}
                  data-row={s.sessionId}
                  tabIndex={0}
                  className={`${openId === s.sessionId ? "row-open" : ""} ${selected.includes(s.sessionId) ? "row-selected" : ""}`}
                  onKeyDown={(e) => onRowKey(e, s.sessionId)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input, button, a, label")) return;
                    openSession(s.sessionId);
                  }}
                  aria-label={`Session ${s.sessionId}`}
                >
                  <td className="col-check">
                    <input type="checkbox" aria-label={`Select session ${s.sessionId}`} checked={selected.includes(s.sessionId)} onChange={() => toggleSelect(s.sessionId)} />
                  </td>
                  {visible.map((c) => (
                    <td key={c.id} className={c.numeric ? "num" : undefined}>
                      {c.render(s, { versionLabel })}
                    </td>
                  ))}
                  <td>
                    <button type="button" className="btn btn-small btn-quiet" onClick={() => openSession(s.sessionId)} aria-label={`Open session ${s.sessionId}`}>
                      Open <Icon name="chevronRight" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.pageCount > 1 ? (
        <nav className="pagination" aria-label="Pages">
          <button type="button" className="btn btn-small" disabled={data.page <= 1} onClick={() => setPage(1)}>
            First
          </button>
          <button type="button" className="btn btn-small" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
            <Icon name="chevronLeft" size={14} /> Previous
          </button>
          <span>
            Page <strong>{data.page}</strong> of {data.pageCount}
          </span>
          <button type="button" className="btn btn-small" disabled={data.page >= data.pageCount} onClick={() => setPage(data.page + 1)}>
            Next <Icon name="chevronRight" size={14} />
          </button>
          <button type="button" className="btn btn-small" disabled={data.page >= data.pageCount} onClick={() => setPage(data.pageCount)}>
            Last
          </button>
        </nav>
      ) : null}
    </>
  );

  const context = { filters, sort, search: debounced, pageSize };

  return (
    <div className={`page ${split ? "page-split" : ""}`}>
      <PageHeader
        title="Sessions"
        description="Every session in the current filters. Open one to inspect it; Previous and Next follow this list."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setSaveOpen(true)}>
              <Icon name="views" size={16} /> Save view
            </button>
            {can("export.sessions") ? (
              <button type="button" className="btn" onClick={() => setExportOpen("filtered")} disabled={!data || data.total === 0}>
                <Icon name="download" size={16} /> Export filtered
              </button>
            ) : null}
          </>
        }
      />
      <FilterBar />
      {split ? (
        <div className="split">
          <div className="split-list">{table}</div>
          <div className="split-detail" aria-label="Selected session">
            {openId ? (
              <SessionDetail sessionId={openId} context={context} onNavigate={(id) => setParam("open", id)} onBack={() => setParam("open", null)} split />
            ) : (
              <EmptyState icon="split" title="Choose a session">
                Select a row to inspect it here while keeping the list in view.
              </EmptyState>
            )}
          </div>
        </div>
      ) : (
        table
      )}
      <ExportDialog
        open={exportOpen !== null}
        onClose={() => setExportOpen(null)}
        initial={{ kind: "sessions", scope: exportOpen === "selected" ? "selected" : "filtered", sessionIds: selected, filters, sort }}
      />
      <SaveViewDialog open={saveOpen} onClose={() => setSaveOpen(false)} canShare={can("views.share")} uid={me?.uid ?? ""} email={me?.email ?? ""} state={{ path: "/sessions", params }} />
    </div>
  );
}

/** Save the current filters, sort and columns as a named view (never the search text). */
export function SaveViewDialog({
  open,
  onClose,
  canShare,
  uid,
  email,
  state,
}: {
  open: boolean;
  onClose: () => void;
  canShare: boolean;
  uid: string;
  email: string;
  state: { path: string; params: URLSearchParams };
}) {
  const announce = useAnnounce();
  const { filters, sort } = useFilters();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      const p = state.params;
      await addDoc(collection(firebase().db, `studies/${STUDY}/savedViews`), {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ownerUid: uid,
        ownerEmail: email.toLowerCase(),
        shared: canShare && shared,
        state: {
          path: state.path,
          filters: JSON.parse(JSON.stringify(filters)),
          sort,
          ...(p.get("cols") ? { columns: p.get("cols")!.split(",") } : {}),
          ...(p.get("dens") ? { density: p.get("dens") } : {}),
          ...(p.get("size") ? { pageSize: Number(p.get("size")) } : {}),
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      announce(`View “${name.trim()}” saved.`, "success");
      setName("");
      setDescription("");
      onClose();
    } catch {
      setErr("The view could not be saved. Check the name (1–80 characters) and try again.");
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save this view"
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            Save view
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="hint">Saves the filters, sort order, columns and page size. Search text is never saved.</p>
      {err ? <Notice tone="warn">{err}</Notice> : null}
      <label>
        Name
        <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incomplete sessions, last 30 days" />
      </label>
      <label>
        Description (optional)
        <input type="text" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={shared} disabled={!canShare} onChange={(e) => setShared(e.target.checked)} />
        Share with all dashboard members {canShare ? "" : "(researchers and administrators only)"}
      </label>
    </Dialog>
  );
}
