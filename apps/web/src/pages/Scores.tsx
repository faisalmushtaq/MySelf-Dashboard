import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  bandRange,
  composeFigure,
  formatNumber,
  OBSERVATION_LABELS,
  OBSERVATIONS,
  parseFigureSpec,
  SCHEME_STATUS_HELP,
  SCHEME_STATUS_LABELS,
  SCORE_GROUP_BY_LABELS,
  SCORE_GROUP_BYS,
  sourceDataCsv,
  THRESHOLD_BASIS_LABELS,
  type Comparison,
  type FigureSpec,
  type Observation,
  type ScoreGroupBy,
  type ScoreOutput,
  type ScoreResult,
  type ScoresView,
  type ScoringScheme,
} from "@myself-dashboard/core";
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/700.css";
import { api } from "../lib/api";
import { useLoad, usePreference } from "../lib/hooks";
import { useFilters } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/States";
import { Icon } from "../components/Icon";
import { saveBlob } from "../lib/figureFiles";
import { ExportDialog } from "../components/ExportDialog";
import { useAuth } from "../app/auth";
import { useFigureBasics, useScoresPrefs } from "../lib/figureContext";

/**
 * Scores: every instrument scored with the study's schemes, set against its
 * threshold bands and benchmarks, and compared across schools and year groups.
 * Aggregates only; the charts are the publication figure panels, so what is
 * seen here is what a report or a paper would show.
 */

const f = (o: ScoreOutput, v: number | null | undefined, extra = 0) => (v === null || v === undefined ? "–" : formatNumber(v, Math.min(3, Math.max(o.decimals, 1) + extra)).replace(/^-/, "−"));

function describeComparison(o: ScoreOutput, c: Comparison, against: string, sd: boolean): string {
  const size = sd && c.standardised !== null ? `${formatNumber(Math.abs(c.standardised), 2)} SD` : `${f(o, Math.abs(c.difference))} points`;
  const dir = c.difference === 0 ? "the same as" : c.difference > 0 ? "above" : "below";
  const ci = c.ci ? ` (difference ${f(o, c.difference)}, 95% CI ${f(o, c.ci[0])} to ${f(o, c.ci[1])})` : "";
  return c.difference === 0 ? `The same as ${against}.` : `${size} ${dir} ${against}${ci}.`;
}

function directionNote(o: ScoreOutput): string {
  return o.higherIs === "better" ? "Higher is better." : o.higherIs === "worse" ? "Higher means more difficulty." : "Neither direction is better.";
}

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

function SchemeCard({ scheme, view }: { scheme: ScoringScheme; view: ScoresView }) {
  const checks = view.checks[scheme.key] ?? [];
  const issues = checks.flatMap((c) => c.issues.map((i) => ({ ...i, version: c.version })));
  return (
    <section className="card scheme-card" aria-labelledby="scheme-title">
      <div className="card-head">
        <div>
          <h2 id="scheme-title">
            {scheme.name} {scheme.abbreviation ? <span className="muted">({scheme.abbreviation})</span> : null}
          </h2>
          <div className="tags">
            <span className={`tag ${scheme.status === "study" ? "tag-quiet" : ""}`} title={SCHEME_STATUS_HELP[scheme.status]}>
              {SCHEME_STATUS_LABELS[scheme.status]}
            </span>
            <span className="tag tag-quiet">
              Scheme {scheme.key} v{scheme.version}
            </span>
            {scheme.verified ? (
              <span className="tag tag-good">
                <Icon name="check" size={12} /> Verified by {scheme.verified.by}, {scheme.verified.at.slice(0, 10)}
              </span>
            ) : (
              <span className="tag tag-warn" title="An administrator marks the scheme verified once it has been checked against the instrument's licensed scoring documents.">
                <Icon name="alert" size={12} /> Not yet verified against the scoring documents
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="scheme-method">{scheme.method}</p>
      {scheme.notes ? <p className="muted small">{scheme.notes}</p> : null}
      <p className="small">
        <Link to="/settings/scoring">How this is scored, its bands and benchmarks, and their versions</Link>
      </p>
      {scheme.status !== "official" ? <p className="muted small">{SCHEME_STATUS_HELP[scheme.status]}</p> : null}
      {issues.length ? (
        <Notice tone="warn">
          <ul className="plain-list">
            {issues.map((i, n) => (
              <li key={n}>
                v{i.version}: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </section>
  );
}

function OutputCard({
  scheme,
  output: o,
  result,
  view,
  tables,
  onOpenInFigures,
  basics,
  collapsed,
}: {
  collapsed: boolean;
  scheme: ScoringScheme;
  output: ScoreOutput;
  result: ScoreResult | undefined;
  view: ScoresView;
  tables: boolean;
  onOpenInFigures: (spec: FigureSpec) => void;
  basics: ReturnType<typeof useFigureBasics>;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [thresholds, setThresholds] = useState(o.thresholds[0]?.key ?? "none");
  const [benchmark, setBenchmark] = useState(o.benchmarks[0]?.key ?? "none");
  const set = o.thresholds.find((t) => t.key === thresholds) ?? null;
  const bench = o.benchmarks.find((b) => b.key === benchmark) ?? null;
  const spec = useMemo(
    () =>
      parseFigureSpec({
        width: "double",
        colour: "colour",
        number: 1,
        title: `${scheme.abbreviation ?? scheme.name}: ${o.label}`,
        panels: [
          { kind: "score_distribution", scheme: scheme.key, output: o.key, thresholds: set ? set.key : "none", benchmark: bench ? bench.key : "none" },
          ...(view.groupBy !== "none" ? [{ kind: "score_groups", scheme: scheme.key, output: o.key, benchmark: bench ? bench.key : "none" }] : []),
          ...(set ? [{ kind: "score_bands", scheme: scheme.key, output: o.key, thresholds: set.key }] : []),
        ],
      }),
    [scheme, o, set, bench, view.groupBy],
  );
  const figure = useMemo(() => (open ? composeFigure(spec, { ...basics, analytics: null, questions: {}, scores: view }, { createdAt: new Date().toISOString() }) : null), [open, spec, basics, view]);
  const overall = result?.overall ?? null;
  const focus = result?.focus;

  if (!open || !figure) {
    return (
      <section className="card output-card output-collapsed" aria-labelledby={`out-${o.key}`}>
        <button type="button" className="disclosure output-toggle" aria-expanded={false} onClick={() => setOpen(true)}>
          <Icon name="chevronRight" size={14} />
          <span id={`out-${o.key}`} className="output-title">
            {o.label}
          </span>
          <span className="muted small">
            {overall ? `mean ${f(o, overall.mean)} (95% CI ${f(o, overall.ci?.[0])} to ${f(o, overall.ci?.[1])}), n = ${formatNumber(overall.n)}` : "no scores"}
            {focus?.summary && view.focus ? ` · ${view.focus.label}: ${f(o, focus.summary.mean)}` : ""}
          </span>
        </button>
      </section>
    );
  }

  const downloadCsv = async () => {
    await api.logChartDownload({ chart: `scores:${scheme.key}.${o.key}` }).catch(() => undefined);
    saveBlob(new Blob(["﻿" + sourceDataCsv(figure)], { type: "text/csv;charset=utf-8" }), `myself_scores_${scheme.key}_${o.key}.csv`);
  };

  return (
    <section className="card output-card" aria-labelledby={`out-${o.key}`}>
      <div className="card-head">
        <div>
          <h3 id={`out-${o.key}`}>
            {collapsed ? (
              <button type="button" className="disclosure" aria-expanded onClick={() => setOpen(false)}>
                <Icon name="chevronDown" size={14} /> {o.label}
              </button>
            ) : (
              o.label
            )}
          </h3>
          <p className="card-desc">
            {o.description ? `${o.description} ` : ""}
            Range {formatNumber(o.range[0])}–{formatNumber(o.range[1])}. {directionNote(o)}
          </p>
        </div>
        <div className="card-tools">
          {o.thresholds.length > 1 ? (
            <label className="inline-select">
              Bands
              <select value={thresholds} onChange={(e) => setThresholds(e.target.value)}>
                {o.thresholds.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
                <option value="none">None</option>
              </select>
            </label>
          ) : null}
          {o.benchmarks.length ? (
            <label className="inline-select">
              Benchmark
              <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
                {o.benchmarks.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
                <option value="none">None</option>
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {!overall ? (
        <p className="muted">No scores under these filters.</p>
      ) : (
        <>
          <dl className="kv-grid score-stats">
            <div>
              <dt>Scored</dt>
              <dd>
                {formatNumber(overall.n)}
                {overall.missing ? <span className="muted small"> · {formatNumber(overall.missing)} without a score</span> : null}
              </dd>
            </div>
            <div>
              <dt>Mean (95% CI)</dt>
              <dd>
                {f(o, overall.mean)} {overall.ci ? <span className="muted">({f(o, overall.ci[0])} to {f(o, overall.ci[1])})</span> : null}
              </dd>
            </div>
            <div>
              <dt>Median (IQR)</dt>
              <dd>
                {f(o, overall.median)} <span className="muted">({f(o, overall.q1)}–{f(o, overall.q3)})</span>
              </dd>
            </div>
            <div>
              <dt>SD</dt>
              <dd>{f(o, overall.sd)}</dd>
            </div>
            {set ? (
              <div className="wide">
                <dt>{set.label}</dt>
                <dd>
                  {set.bands.map((b, i) => (
                    <span key={b.label} className="band-share">
                      {b.label} <strong>{Math.round((overall.bands[set.key]?.[i]?.share ?? 0) * 100)}%</strong>
                      {set.expected ? <span className="muted"> (expected {Math.round(set.expected[i]! * 100)}%)</span> : null}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          <ul className="plain-list comparisons">
            {bench && result?.vsBenchmarks[bench.key] ? (
              <li>
                <strong>All selected sittings:</strong> {describeComparison(o, result.vsBenchmarks[bench.key]!, `${bench.label} (mean ${f(o, bench.mean)}${bench.sd ? `, SD ${f(o, bench.sd)}` : ""})`, !!bench.sd)}
              </li>
            ) : null}
            {focus && view.focus ? (
              <li>
                <strong>{view.focus.label}:</strong>{" "}
                {focus.summary ? (
                  <>
                    mean {f(o, focus.summary.mean)} (n = {formatNumber(focus.summary.n)}).{" "}
                    {focus.vsPeers ? describeComparison(o, focus.vsPeers, `${view.focus.peersLabel.toLowerCase()} (mean ${f(o, focus.peers!.mean)}, n = ${formatNumber(focus.peers!.n)})`, false) : ""}{" "}
                    {bench && focus.vsBenchmarks[bench.key] ? describeComparison(o, focus.vsBenchmarks[bench.key]!, bench.label, !!bench.sd) : ""}
                    {focus.small ? <span className="tag tag-warn small-group">Fewer than {view.minCell}: interpret with care, and do not report on its own</span> : null}
                  </>
                ) : (
                  "no scores."
                )}
              </li>
            ) : null}
          </ul>

          <div className="paper-scroll">
            {/* The SVG is built by the figure renderer, which escapes every string it draws. */}
            <div className="paper" role="img" aria-label={figure.description} dangerouslySetInnerHTML={{ __html: figure.svg.replace(/^<\?xml[^>]*>\s*/, "") }} />
          </div>
          <details className="figure-notes">
            <summary>Figure legend and sources</summary>
            <p className="figure-legend">{figure.legend}</p>
            {set ? (
              <p className="small">
                <strong>{set.label}</strong> ({THRESHOLD_BASIS_LABELS[set.basis].toLowerCase()}
                {set.verified ? ", verified" : ", not yet verified"}): {set.source}
                {set.note ? ` ${set.note}` : ""}
              </p>
            ) : null}
            {bench ? (
              <p className="small">
                <strong>{bench.label}</strong> ({bench.population}; {bench.verified ? "verified" : "not yet verified"}): {bench.source}
              </p>
            ) : null}
          </details>
          {figure.warnings.length ? (
            <Notice tone="warn">
              <ul className="plain-list">
                {figure.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="export-row">
            <button type="button" className="btn btn-small" onClick={() => onOpenInFigures(spec)}>
              <Icon name="figure" size={14} /> Open in Figures
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => void downloadCsv()}>
              <Icon name="download" size={14} /> Source data (CSV)
            </button>
          </div>
          {tables ? <GroupTable output={o} result={result!} set={set} view={view} /> : null}
        </>
      )}
    </section>
  );
}

function GroupTable({ output: o, result, set, view }: { output: ScoreOutput; result: ScoreResult; set: ScoreOutput["thresholds"][number] | null; view: ScoresView }) {
  const rows = [{ key: "__all", label: "All", n: result.overall?.n ?? 0, small: false, summary: result.overall }, ...result.groups];
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${o.label} by ${SCORE_GROUP_BY_LABELS[view.groupBy].toLowerCase()}`}>
      <table className="data compact">
        <caption className="sr-only">{o.label} by {SCORE_GROUP_BY_LABELS[view.groupBy].toLowerCase()}</caption>
        <thead>
          <tr>
            <th scope="col">{SCORE_GROUP_BY_LABELS[view.groupBy]}</th>
            <th scope="col" className="num">n</th>
            <th scope="col" className="num">Mean</th>
            <th scope="col" className="num">95% CI</th>
            <th scope="col" className="num">SD</th>
            <th scope="col" className="num">Median</th>
            {set?.bands.map((b, i) => (
              <th key={b.label} scope="col" className="num" title={`${b.label}: ${bandRange(set, i, o)}`}>
                % {b.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <th scope="row">
                {g.label}
                {g.small ? <span className="muted" title={`Fewer than ${view.minCell} scores`}> *</span> : null}
              </th>
              <td className="num">{formatNumber(g.n)}</td>
              <td className="num">{f(o, g.summary?.mean)}</td>
              <td className="num">{g.summary?.ci ? `${f(o, g.summary.ci[0])} to ${f(o, g.summary.ci[1])}` : "–"}</td>
              <td className="num">{f(o, g.summary?.sd)}</td>
              <td className="num">{f(o, g.summary?.median)}</td>
              {set?.bands.map((b, i) => (
                <td key={b.label} className="num">
                  {g.summary?.bands[set.key] ? `${Math.round(g.summary.bands[set.key]![i]!.share * 100)}%` : "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => r.small) ? <p className="hint">* Fewer than {view.minCell} scores: shown for the research team, suppressed in reports for schools.</p> : null}
    </div>
  );
}
