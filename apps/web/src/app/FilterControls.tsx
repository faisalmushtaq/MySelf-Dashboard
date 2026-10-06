import { useState } from "react";
import {
  DATASET_LABELS,
  DATE_BASIS_LABELS,
  DATE_BASES,
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  describeFilters,
  DISPLAY_STATUSES,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  STATUS_LABELS,
  WARNING_LABELS,
  type DatePreset,
  type DateBasis,
  type DisplayStatus,
  type ReviewStatus,
} from "@myself-dashboard/core";
import { Icon } from "../components/Icon";
import { Popover } from "../components/Popover";
import { StatusDot } from "../components/Status";
import { useFilters } from "./filters";
import { useStudyData, useSurveyReleases } from "./data";

/** The global date range: presets as rows, custom range below a hairline. */
export function DateRangeControl() {
  const { filters, update } = useFilters();
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const label =
    filters.datePreset === "custom" ? `${filters.from ?? "…"} – ${filters.to ?? "…"}` : DATE_PRESET_LABELS[filters.datePreset];
  return (
    <Popover
      label="Date range"
      button={
        <>
          <Icon name="clock" size={16} />
          <span className="ctl-label">{label}</span>
          <span className="ctl-sub">by {filters.dateBasis.replace("_", " ")}</span>
          <Icon name="chevronDown" size={14} />
        </>
      }
    >
      {(close) => (
        <div className="date-pop">
          <fieldset>
            <legend>Date range</legend>
            {DATE_PRESETS.filter((p) => p !== "custom").map((p: DatePreset) => (
              <button
                key={p}
                type="button"
                className={`menu-row ${filters.datePreset === p ? "selected" : ""}`}
                aria-pressed={filters.datePreset === p}
                onClick={() => {
                  update({ datePreset: p });
                  close();
                }}
              >
                <span className="menu-check">{filters.datePreset === p ? <Icon name="check" size={16} /> : null}</span>
                {DATE_PRESET_LABELS[p]}
              </button>
            ))}
          </fieldset>
          <form
            className="custom-range"
            onSubmit={(e) => {
              e.preventDefault();
              update({ datePreset: "custom", ...(from ? { from } : {}), ...(to ? { to } : {}) });
              close();
            }}
          >
            <div className="field-row">
              <label>
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="btn btn-small" disabled={!from && !to}>
              Apply custom range
            </button>
          </form>
          <label className="basis">
            Dates are
            <select value={filters.dateBasis} onChange={(e) => update({ dateBasis: e.target.value as DateBasis })}>
              {DATE_BASES.map((b) => (
                <option key={b} value={b}>
                  {DATE_BASIS_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Days are counted in the study time zone. Device clocks can be wrong; “First received” uses the server's clock.</p>
        </div>
      )}
    </Popover>
  );
}

/**
 * The survey filter (docs/12 §12.6): every survey of the study, or one. Shown
 * only where there is a choice — a study with one survey has nothing to filter
 * — or while a survey filter from a link is in force.
 */
export function SurveyControl() {
  const { filters, update } = useFilters();
  const { surveys, surveyTitle } = useStudyData();
  if (surveys.length < 2 && filters.surveys.length === 0) return null;
  const value = filters.surveys.length === 1 ? filters.surveys[0]! : filters.surveys.length === 0 ? "" : "__many";
  return (
    <label className="version-ctl survey-ctl">
      <span className="sr-only">Survey</span>
      <Icon name="note" size={16} />
      <select
        value={value}
        // A version belongs to one survey: choosing a survey starts its versions afresh.
        onChange={(e) => update({ surveys: e.target.value ? [e.target.value] : [], versions: [] })}
        aria-label="Survey"
      >
        <option value="">All surveys</option>
        {value === "__many" ? <option value="__many">{filters.surveys.length} surveys</option> : null}
        {surveys.map((s) => (
          <option key={s.surveyId} value={s.surveyId}>
            {s.title}
          </option>
        ))}
        {filters.surveys.filter((id) => !surveys.some((s) => s.surveyId === id)).map((id) => (
          <option key={id} value={id}>
            {surveyTitle(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function VersionControl() {
  const { filters, update } = useFilters();
  const { byNewest, activeRelease } = useSurveyReleases();
  const value = filters.versions.length === 1 ? filters.versions[0]! : filters.versions.length === 0 ? "" : "__many";
  return (
    <label className="version-ctl">
      <span className="sr-only">Survey version</span>
      <Icon name="reports" size={16} />
      <select
        value={value}
        onChange={(e) => update({ versions: e.target.value ? [e.target.value] : [] })}
        aria-label="Survey version"
      >
        <option value="">All survey versions</option>
        {value === "__many" ? <option value="__many">{filters.versions.length} versions</option> : null}
        {byNewest.map((r) => (
          <option key={r.hash} value={r.hash}>
            v{r.version}
            {activeRelease?.hash === r.hash ? " (active)" : ""}
          </option>
        ))}
        <option value="unknown">Unknown version</option>
      </select>
    </label>
  );
}

function toggle<T>(xs: readonly T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

/** The filter row above the content it scopes, and chips for what is active. */
export function FilterBar({ showStatus = true }: { showStatus?: boolean }) {
  const { filters, update, clear, reset } = useFilters();
  const { versionLabel, surveyTitle } = useStudyData();
  const [cmin, setCmin] = useState(filters.completionMin?.toString() ?? "");
  const [cmax, setCmax] = useState(filters.completionMax?.toString() ?? "");
  const chips = describeFilters(filters, { version: versionLabel, survey: surveyTitle });
  return (
    <section className="filterbar" aria-label="Filters">
      <div className="filter-row">
        {showStatus ? (
          <Popover label="Status" button={<><Icon name="filter" size={16} /> Status{filters.statuses.length ? ` (${filters.statuses.length})` : ""}</>}>
            {() => (
              <fieldset className="check-list">
                <legend>Session status</legend>
                {DISPLAY_STATUSES.map((s: DisplayStatus) => (
                  <label key={s}>
                    <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => update({ statuses: toggle(filters.statuses, s) })} />
                    <StatusDot status={s} /> {STATUS_LABELS[s]}
                  </label>
                ))}
              </fieldset>
            )}
          </Popover>
        ) : null}
        <Popover label="Completion" button={<>Completion{filters.completionMin !== undefined || filters.completionMax !== undefined ? ` (${filters.completionMin ?? 0}–${filters.completionMax ?? 100}%)` : ""}</>}>
          {(close) => (
            <form
              className="range-form"
              onSubmit={(e) => {
                e.preventDefault();
                const patch: Record<string, number | undefined> = {};
                const lo = cmin === "" ? undefined : Number(cmin);
                const hi = cmax === "" ? undefined : Number(cmax);
                const next = { ...filters };
                delete next.completionMin;
                delete next.completionMax;
                if (lo !== undefined && Number.isFinite(lo)) next.completionMin = Math.max(0, Math.min(100, lo));
                if (hi !== undefined && Number.isFinite(hi)) next.completionMax = Math.max(0, Math.min(100, hi));
                void patch;
                update(next);
                close();
              }}
            >
              <p className="hint">Required-answer completion, 0–100%.</p>
              <div className="field-row">
                <label>
                  At least
                  <input type="number" min={0} max={100} inputMode="numeric" value={cmin} onChange={(e) => setCmin(e.target.value)} />
                </label>
                <label>
                  At most
                  <input type="number" min={0} max={100} inputMode="numeric" value={cmax} onChange={(e) => setCmax(e.target.value)} />
                </label>
              </div>
              <button type="submit" className="btn btn-small">
                Apply
              </button>
            </form>
          )}
        </Popover>
        <label className="inline-select">
          Flags
          <select value={filters.flagged} onChange={(e) => update({ flagged: e.target.value as typeof filters.flagged })}>
            <option value="any">Any</option>
            <option value="flagged">Flagged</option>
            <option value="unflagged">Not flagged</option>
          </select>
        </label>
        <label className="inline-select">
          Data
          <select value={filters.dataset} onChange={(e) => update({ dataset: e.target.value as typeof filters.dataset })}>
            {Object.entries(DATASET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Popover label="More filters" button={<>More filters</>}>
          {() => (
            <div className="more-filters">
              <fieldset className="check-list">
                <legend>Review status</legend>
                {REVIEW_STATUSES.map((s: ReviewStatus) => (
                  <label key={s}>
                    <input type="checkbox" checked={filters.reviewStatuses.includes(s)} onChange={() => update({ reviewStatuses: toggle(filters.reviewStatuses, s) })} />
                    {REVIEW_STATUS_LABELS[s]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="check-list">
                <legend>Source</legend>
                {[
                  ["device", "Uploaded by the device"],
                  ["imported", "Imported from a handover file"],
                ].map(([k, v]) => (
                  <label key={k}>
                    <input type="checkbox" checked={filters.sources.includes(k!)} onChange={() => update({ sources: toggle(filters.sources, k!) })} />
                    {v}
                  </label>
                ))}
              </fieldset>
              <label className="stack-label">
                Site (study-code letters)
                <input
                  type="text"
                  placeholder="e.g. NDC"
                  defaultValue={filters.sites.join(",")}
                  onBlur={(e) =>
                    update({
                      sites: e.target.value
                        .split(",")
                        .map((s) => s.trim().toUpperCase())
                        .filter((s) => /^[A-Z]{1,10}$/.test(s)),
                    })
                  }
                />
              </label>
              <label className="stack-label">
                Data-quality signal
                <select value={filters.warning ?? ""} onChange={(e) => update(e.target.value ? { warning: e.target.value } : { warning: undefined as never })}>
                  <option value="">Any</option>
                  {Object.entries(WARNING_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </Popover>
      </div>
      {chips.length ? (
        <div className="chips" aria-label="Active filters">
          {chips.map((c) => (
            <span className="chip" key={c.key}>
              {c.label}
              <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={() => clear(c.key)}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
          <button type="button" className="btn-link" onClick={reset}>
            Reset all filters
          </button>
        </div>
      ) : null}
    </section>
  );
}
