import { useMemo, useState } from "react";
import {
  composeFigure,
  DATE_BASIS_LABELS,
  DEFAULT_FIGURE,
  defaultPanel,
  describeFilters,
  FIGURE_WIDTHS,
  formatDay,
  PANEL_KINDS,
  PANEL_NAMES,
  parseFigureSpec,
  rangeFor,
  RULES_VERSION,
  sourceDataCsv,
  type ColourMode,
  type FigureContext,
  type FigureSpec,
  type FigureWidth,
  type PanelKind,
  type PanelSpec,
  type QuestionData,
  type ScoresView,
} from "@myself-dashboard/core";
import { useScoresPrefs } from "../lib/figureContext";
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/700.css";
import "@fontsource/arimo/400-italic.css";
import { api, explain } from "../lib/api";
import { useLoad, usePreference } from "../lib/hooks";
import { useFilters } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { useStudyData } from "../app/data";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { PageHeader } from "../components/Metric";
import { ErrorState, Notice, Skeleton } from "../components/States";
import { Icon } from "../components/Icon";
import { useAnalytics } from "./Overview";
import { pdfBlob, pngBlob, saveBlob, svgBlob, tiffBlob, type FigureFormat } from "../lib/figureFiles";
import { PanelOptions } from "./figures/PanelOptions";

/**
 * Publication figures from the current filters: journal column widths,
 * Arial/Helvetica at 6–8 pt, colour-blind-safe or greyscale colours, a draft
 * figure legend and the source data behind every panel. Drawn in the browser
 * from the same aggregates as the rest of the dashboard; every file that
 * leaves is recorded in the audit log.
 */

const WIDTHS = Object.keys(FIGURE_WIDTHS) as FigureWidth[];
const questionPanel = (p: PanelSpec): p is Extract<PanelSpec, { kind: "items" | "responses" }> => p.kind === "items" || p.kind === "responses";

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export default function Figures() {
  const { filters } = useFilters();
  const { me, can } = useAuth();
  const announce = useAnnounce();
  const { byNewest, activeRelease } = useStudyData();
  const analytics = useAnalytics();
  const [stored, setStored] = usePreference<unknown>("figure-spec", DEFAULT_FIGURE);
  const spec = useMemo(() => parseFigureSpec(stored), [stored]);
  const setSpec = (s: FigureSpec) => setStored(s);
  const [zoom, setZoom] = useState<"actual" | "fit">("fit");
  const [dpi, setDpi] = useState(600);
  const [busy, setBusy] = useState<FigureFormat | "csv" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const policy = me?.policy;
  const timeZone = policy?.timeZone ?? "Europe/London";
  const fallbackVersion = (filters.versions.length === 1 && filters.versions[0] !== "unknown" ? filters.versions[0] : activeRelease?.hash) ?? "";

  // Question panels without a chosen version follow the filter (or the live version).
  const effective: FigureSpec = useMemo(
    () => ({ ...spec, panels: spec.panels.map((p) => (questionPanel(p) && !p.version ? { ...p, version: fallbackVersion } : p)) }),
    [spec, fallbackVersion],
  );
  // Score panels read the Scores view, grouped and counted as on the Scores page.
  const [scorePrefs] = useScoresPrefs();
  const wantsScores = effective.panels.some((p) => p.kind.startsWith("score_"));
  const scores = useLoad<ScoresView>(
    () =>
      api.getScores({
        filters,
        observation: scorePrefs.observation,
        groupBy: scorePrefs.groupBy,
        focus: scorePrefs.focus.school || scorePrefs.focus.yearGroup !== null ? scorePrefs.focus : null,
      }),
    [JSON.stringify(filters), JSON.stringify(scorePrefs), wantsScores],
    { enabled: wantsScores },
  );
  const neededVersions = [...new Set(effective.panels.filter(questionPanel).map((p) => p.version).filter(Boolean))].sort();
  const questionKey = JSON.stringify([neededVersions, filters]);
  const questions = useLoad<Record<string, QuestionData>>(
    async () => {
      const out: Record<string, QuestionData> = {};
      for (const v of neededVersions) {
        const r = await api.getQuestionAnalytics({ filters, versionHash: v });
        out[v] = { version: r.release.version, sessions: r.sessions, stats: r.stats };
      }
      return out;
    },
    [questionKey],
    { enabled: neededVersions.length > 0 },
  );

  const versionLabel = (hash: string) => {
    const r = byNewest.find((x) => x.hash === hash);
    return r ? `v${r.version}` : "an unregistered version";
  };

  const period = useMemo(() => {
    const now = new Date();
    const r = rangeFor(filters, { now, timeZone });
    const basis = DATE_BASIS_LABELS[filters.dateBasis].replace(/ \(.*\)$/, "").toLowerCase();
    if (r.fromDay && r.toDay) return `${formatDay(r.fromDay)} to ${formatDay(r.toDay)} (by ${basis})`;
    if (r.toDay) return `up to ${formatDay(r.toDay)} (by ${basis})`;
    return `all dates to ${formatDay(dayOf(now.toISOString()))}`;
  }, [filters, timeZone]);

  const filterText = useMemo(
    () =>
      describeFilters(filters, { version: versionLabel })
        .filter((f) => f.key !== "date")
        .map((f) => f.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, byNewest],
  );

  const figure = useMemo(() => {
    if (!analytics.data) return null;
    const ctx: FigureContext = {
      analytics: analytics.data.analytics,
      questions: questions.data ?? {},
      period,
      filters: filterText,
      timeZone,
      rulesVersion: RULES_VERSION,
      requiredLevels: policy?.requiredLevels ?? ["hard", "soft"],
      abandonAfterHours: policy?.abandonAfterHours ?? 24,
      versionLabel,
      scores: scores.data ?? null,
    };
    return composeFigure(effective, ctx, { createdAt: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, analytics.data, questions.data, scores.data, period, filterText, policy, timeZone, byNewest]);

  const updatePanel = (i: number, p: PanelSpec) => setSpec({ ...spec, panels: spec.panels.map((x, j) => (j === i ? p : x)) });
  const move = (i: number, d: -1 | 1) => {
    const panels = [...spec.panels];
    const [p] = panels.splice(i, 1);
    panels.splice(i + d, 0, p!);
    setSpec({ ...spec, panels });
  };
  const remove = (i: number) => setSpec({ ...spec, panels: spec.panels.filter((_, j) => j !== i) });
  const add = (kind: PanelKind) => setSpec({ ...spec, panels: [...spec.panels, defaultPanel(kind)] });

  const stem = `myself_fig${spec.number}_${spec.width === "onehalf" ? "1.5-column" : `${spec.width}-column`}_${dayOf(new Date().toISOString())}`;

  async function download(format: FigureFormat | "csv") {
    if (!figure) return;
    setBusy(format);
    setExportError(null);
    try {
      const title = `Fig. ${spec.number} | ${spec.title}`;
      let blob: Blob;
      let name: string;
      if (format === "svg") [blob, name] = [svgBlob(figure), `${stem}.svg`];
      else if (format === "pdf") [blob, name] = [await pdfBlob(figure, title), `${stem}.pdf`];
      else if (format === "png") [blob, name] = [await pngBlob(figure, dpi), `${stem}_${dpi}dpi.png`];
      else if (format === "tiff") [blob, name] = [await tiffBlob(figure, dpi), `${stem}_${dpi}dpi.tif`];
      else [blob, name] = [new Blob([sourceDataCsv(figure)], { type: "text/csv;charset=utf-8" }), `${stem}_source-data.csv`];
      // Recorded before it is handed over: a file whose export cannot be
      // audited is not released.
      try {
        await api.logFigureExport({
          format,
          panels: effective.panels.map((p) => p.kind),
          width: spec.width,
          colour: spec.colour,
          dpi: format === "png" || format === "tiff" ? dpi : null,
        });
      } catch (e) {
        throw new Error(`The download could not be recorded in the audit log, so it was not started. ${explain(e).message}`);
      }
      saveBlob(blob, name);
      announce(`${name} downloaded.`, "success");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : explain(e).message);
    } finally {
      setBusy(null);
    }
  }

  const copyLegend = async () => {
    if (!figure) return;
    try {
      await navigator.clipboard.writeText(figure.legend);
      announce("Figure legend copied.", "success");
    } catch {
      announce("The legend could not be copied — select the text and copy it instead.", "info");
    }
  };

  const loading = analytics.loading || questions.loading;
  const canExport = can("export.aggregate");

  return (
    <div className="page figures-page">
      <PageHeader
        title="Figures"
        description={
          <>
            Publication-ready figures from the current filters: sized to journal columns, set in Arial/Helvetica at 6–8 pt, in colour-blind-safe colours or
            greyscale, with a draft figure legend and the source data behind every panel.
          </>
        }
      />
      <FilterBar />
      {analytics.error && !analytics.data ? <ErrorState title="The figure data could not be loaded" message={analytics.error.message} onRetry={analytics.reload} /> : null}
      <div className="figure-layout">
        <form className="card figure-setup" aria-labelledby="figure-setup-title" onSubmit={(e) => e.preventDefault()}>
          <h2 id="figure-setup-title">Figure</h2>
          <fieldset className="radio-row">
            <legend>Width</legend>
            {WIDTHS.map((w) => (
              <label key={w}>
                <input type="radio" name="fig-width" checked={spec.width === w} onChange={() => setSpec({ ...spec, width: w })} />
                {FIGURE_WIDTHS[w].label}
              </label>
            ))}
          </fieldset>
          <fieldset className="radio-row">
            <legend>Colour</legend>
            {(["colour", "greyscale"] as ColourMode[]).map((c) => (
              <label key={c}>
                <input type="radio" name="fig-colour" checked={spec.colour === c} onChange={() => setSpec({ ...spec, colour: c })} />
                {c === "colour" ? "Colour-blind safe" : "Greyscale"}
              </label>
            ))}
          </fieldset>
          <div className="field-row">
            <label className="fig-number">
              Figure number
              <input type="number" min={1} max={99} value={spec.number} onChange={(e) => setSpec({ ...spec, number: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <label className="grow">
              Title (for the legend)
              <input type="text" maxLength={300} value={spec.title} onChange={(e) => setSpec({ ...spec, title: e.target.value })} />
            </label>
          </div>

          <h3 className="panels-title">Panels</h3>
          <ol className="panel-list">
            {spec.panels.map((p, i) => (
              <li key={i} className="panel-item">
                <div className="panel-head">
                  <span className="panel-letter" aria-hidden="true">
                    {spec.panels.length > 1 ? "abcdef"[i] : "–"}
                  </span>
                  <label className="grow">
                    <span className="sr-only">Panel {spec.panels.length > 1 ? "abcdef"[i] : ""} shows</span>
                    <select value={p.kind} onChange={(e) => updatePanel(i, defaultPanel(e.target.value as PanelKind, questionPanel(p) ? p.version : ""))}>
                      {PANEL_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {PANEL_NAMES[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="panel-tools">
                    <button type="button" className="icon-btn" aria-label={`Move panel ${"abcdef"[i]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Move panel ${"abcdef"[i]} down`} disabled={i === spec.panels.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove panel ${"abcdef"[i]}`} disabled={spec.panels.length === 1} onClick={() => remove(i)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
                <PanelOptions panel={p} effectiveVersion={questionPanel(p) ? p.version || fallbackVersion : ""} questions={questions.data ?? {}} onChange={(np) => updatePanel(i, np)} releases={byNewest} schemes={scores.data?.schemes ?? []} />
              </li>
            ))}
          </ol>
          <div className="field-row">
            <label className="grow">
              Add a panel
              <select
                value=""
                disabled={spec.panels.length >= 6}
                onChange={(e) => {
                  if (e.target.value) add(e.target.value as PanelKind);
                }}
              >
                <option value="">{spec.panels.length >= 6 ? "Six panels is the most a figure takes" : "Choose what it shows…"}</option>
                {PANEL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PANEL_NAMES[k]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-quiet" onClick={() => setSpec(DEFAULT_FIGURE)}>
              Start again
            </button>
          </div>
        </form>

        <section className="figure-output" aria-labelledby="figure-preview-title">
          <div className="toolbar figure-toolbar">
            <h2 id="figure-preview-title">Preview</h2>
            {figure ? (
              <span className="hint">
                {Math.round(figure.widthMm)} × {Math.round(figure.heightMm)} mm
              </span>
            ) : null}
            <div className="segmented" role="group" aria-label="Preview size">
              <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
                Fit
              </button>
              <button type="button" aria-pressed={zoom === "actual"} onClick={() => setZoom("actual")}>
                Actual size
              </button>
            </div>
          </div>
          {!figure ? (
            <Skeleton lines={10} />
          ) : (
            <>
              <div className={`paper-scroll ${loading ? "dimmed" : ""}`} aria-busy={loading}>
                {/* The SVG is built by the figure renderer, which escapes every survey string (tested). */}
                <div
                  className="paper"
                  role="img"
                  aria-label={figure.description}
                  style={zoom === "actual" ? { width: `${figure.widthMm}mm` } : undefined}
                  dangerouslySetInnerHTML={{ __html: figure.svg.replace(/^<\?xml[^>]*>\s*/, "") }}
                />
              </div>
              {figure.warnings.length ? (
                <Notice tone="warn">
                  <ul className="plain-list">
                    {figure.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {questions.error ? <Notice tone="warn">Question data could not be loaded: {questions.error.message}</Notice> : null}

              <div className="card figure-legend-card">
                <div className="card-head">
                  <h3>Figure legend</h3>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => void copyLegend()}>
                    Copy
                  </button>
                </div>
                <p className="figure-legend">{figure.legend}</p>
                <p className="hint">A draft: check it against your journal's style, and add your statistical tests.</p>
              </div>

              {canExport ? (
                <div className="card figure-export">
                  <h3>Download</h3>
                  <div className="export-row">
                    <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void download("pdf")}>
                      <Icon name="download" size={16} /> PDF (vector)
                    </button>
                    <button type="button" className="btn" disabled={!!busy} onClick={() => void download("svg")}>
                      SVG (vector)
                    </button>
                    <button type="button" className="btn" disabled={!!busy} onClick={() => void download("png")}>
                      PNG
                    </button>
                    <button type="button" className="btn" disabled={!!busy} onClick={() => void download("tiff")}>
                      TIFF
                    </button>
                    <label className="inline-select">
                      Resolution
                      <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                        <option value={300}>300 dpi</option>
                        <option value={600}>600 dpi</option>
                        <option value={1200}>1200 dpi (line art)</option>
                      </select>
                    </label>
                    <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download("csv")}>
                      Source data (CSV)
                    </button>
                  </div>
                  <p className="hint" aria-live="polite">
                    {busy ? `Preparing the ${busy.toUpperCase()} file…` : "Vector PDF or SVG keeps text editable and is what most journals prefer for charts. Every download is recorded in the audit log."}
                  </p>
                  {exportError ? <Notice tone="warn">{exportError}</Notice> : null}
                </div>
              ) : null}

              <details className="card source-data">
                <summary>Source data: the numbers drawn in each panel</summary>
                {figure.source.slice(1).map((t) => (
                  <div key={`${t.panel}-${t.title}`} className="table-wrap">
                    <table className="data">
                      <caption>{t.panel ? `Panel ${t.panel}: ${t.title}` : t.title}</caption>
                      <thead>
                        <tr>
                          {t.columns.map((c) => (
                            <th key={c} scope="col">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((v, j) => (
                              <td key={j} className={typeof v === "number" ? "num" : undefined}>
                                {v === null ? "—" : String(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
