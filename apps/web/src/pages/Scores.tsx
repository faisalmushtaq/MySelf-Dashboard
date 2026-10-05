import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatNumber, OBSERVATION_LABELS, OBSERVATIONS, SCORE_GROUP_BY_LABELS, SCORE_GROUP_BYS, type Observation, type ScoreGroupBy, type ScoresView } from "@myself-dashboard/core";
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/700.css";
import { api } from "../lib/api";
import { useLoad, usePreference } from "../lib/hooks";
import { useFilters } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { Icon } from "../components/Icon";
import { ExportDialog } from "../components/ExportDialog";
import { useAuth } from "../app/auth";
import { useFigureBasics, useScoresPrefs } from "../lib/figureContext";
import { SchemeCard } from "./scores/SchemeCard";
import { OutputCard } from "./scores/OutputCard";

/**
 * Scores: every instrument scored with the study's schemes, set against its
 * threshold bands and benchmarks, and compared across schools and year groups.
 * Aggregates only; the charts are the publication figure panels, so what is
 * seen here is what a report or a paper would show.
 */

export default function Scores() {
  const { filters } = useFilters();
  const [prefs, setPrefs] = useScoresPrefs();
  const basics = useFigureBasics();
  const navigate = useNavigate();
  const [tables, setTables] = usePreference<boolean>("scores-tables", false);
  const focusKey = JSON.stringify(prefs.focus);
  const scores = useLoad<ScoresView>(
    () => api.getScores({ filters, observation: prefs.observation, groupBy: prefs.groupBy, focus: prefs.focus.school || prefs.focus.yearGroup !== null ? prefs.focus : null }),
    [JSON.stringify(filters), prefs.observation, prefs.groupBy, focusKey],
  );
  const view = scores.data;
  const scheme = view?.schemes.find((s) => s.key === prefs.scheme) ?? view?.schemes[0] ?? null;
  const set = (patch: Partial<typeof prefs>) => setPrefs({ ...prefs, ...patch });
  const { can } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="page">
      <PageHeader
        title="Scores"
        description="Each instrument scored with the study's scoring schemes, against its published thresholds and benchmarks, and compared across schools and year groups. Aggregates only."
      />
      <FilterBar />
      <div className="card filter-row scores-controls" role="group" aria-label="What to show">
        <label className="inline-select">
          Instrument
          <select value={scheme?.key ?? prefs.scheme} onChange={(e) => set({ scheme: e.target.value })} disabled={!view}>
            {(view?.schemes ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.abbreviation ? `${s.abbreviation} — ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          Compare by
          <select value={prefs.groupBy} onChange={(e) => set({ groupBy: e.target.value as ScoreGroupBy })}>
            {SCORE_GROUP_BYS.map((g) => (
              <option key={g} value={g}>
                {SCORE_GROUP_BY_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          Count
          <select value={prefs.observation} onChange={(e) => set({ observation: e.target.value as Observation })}>
            {OBSERVATIONS.map((o) => (
              <option key={o} value={o}>
                {OBSERVATION_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <span className="controls-divider" aria-hidden="true" />
        <label className="inline-select">
          Focus on school
          <select value={prefs.focus.school ?? ""} onChange={(e) => set({ focus: { ...prefs.focus, school: e.target.value || null } })}>
            <option value="">None</option>
            {(view?.available.schools ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          Year group
          <select value={prefs.focus.yearGroup ?? ""} onChange={(e) => set({ focus: { ...prefs.focus, yearGroup: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">All</option>
            {(view?.available.yearGroups ?? []).map((y) => (
              <option key={y.key} value={y.key}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> Show tables
        </label>
      </div>

      {scores.error ? <ErrorState message={scores.error.message} onRetry={() => void scores.reload()} /> : null}
      {!view && !scores.error ? <Skeleton lines={12} /> : null}
      {view && scheme ? (
        <div className={scores.loading ? "dimmed" : undefined} aria-busy={scores.loading}>
          {view.focus?.school && can("export.aggregate") ? (
            <div className="export-row">
              <button type="button" className="btn btn-primary" onClick={() => setReportOpen(true)}>
                <Icon name="reports" size={16} /> School report for {view.focus.label} (PDF)
              </button>
            </div>
          ) : null}
          <p className="muted small scores-basis">
            {formatNumber(view.counts.sittings)} sittings from {formatNumber(view.counts.participants)} participants ({OBSERVATION_LABELS[view.observation].toLowerCase()}), {view.counts.schools} school
            {view.counts.schools === 1 ? "" : "s"}, {basics.period}
            {view.focus ? (
              <>
                {" "}
                · Focus: <strong>{view.focus.label}</strong> against {view.focus.peersLabel.toLowerCase()}
              </>
            ) : null}
          </p>
          <SchemeCard scheme={scheme} view={view} />
          {[...scheme.outputs]
            .sort((a, b) => Number(b.primary) - Number(a.primary))
            .map((o, i) => {
              const result = view.results.find((r) => r.scheme === scheme.key && r.output === o.key);
              return (
                <OutputCard
                  collapsed={i > 0 && !o.primary}
                  key={o.key}
                  scheme={scheme}
                  output={o}
                  result={result}
                  view={view}
                  tables={tables}
                  onOpenInFigures={(spec) => {
                    try {
                      localStorage.setItem("pref:figure-spec", JSON.stringify(spec));
                    } catch {
                      // Storage unavailable: the Figures page opens with its own default.
                    }
                    navigate("/figures");
                  }}
                  basics={basics}
                />
              );
            })}
        </div>
      ) : null}
      <ExportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        initial={{ kind: "school_report", scope: "filtered", filters, school: prefs.focus.school, yearGroup: prefs.focus.yearGroup, observation: prefs.observation }}
      />
      {view && !scheme ? <EmptyState icon="figure" title="No scoring schemes">An administrator can add them in Settings → Scoring.</EmptyState> : null}
    </div>
  );
}
