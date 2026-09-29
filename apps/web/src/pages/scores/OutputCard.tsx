import { useMemo, useState } from "react";
import {
  bandRange,
  composeFigure,
  formatNumber,
  parseFigureSpec,
  SCORE_GROUP_BY_LABELS,
  sourceDataCsv,
  THRESHOLD_BASIS_LABELS,
  type Comparison,
  type FigureSpec,
  type ScoreOutput,
  type ScoreResult,
  type ScoresView,
  type ScoringScheme,
} from "@myself-dashboard/core";
import { api } from "../../lib/api";
import { saveBlob } from "../../lib/figureFiles";
import type { useFigureBasics } from "../../lib/figureContext";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/States";

/** Scores (../Scores.tsx): one score — statistics, comparisons, its figure and, optionally, its table by group. */

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

export function OutputCard({
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
