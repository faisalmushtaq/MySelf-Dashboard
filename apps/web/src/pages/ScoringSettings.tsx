import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  bandRange,
  formatNumber,
  parseScheme,
  SCHEME_STATUS_LABELS,
  THRESHOLD_BASIS_LABELS,
  THRESHOLD_BASES,
  YEAR_GROUP_SOURCE_LABELS,
  YEAR_GROUP_SOURCES,
  type GroupSettings,
  type SchemeSettingsView,
  type ScoreBenchmark,
  type ScoreOutput,
  type ScoresView,
  type ScoringScheme,
  type ScoringSettingsView,
  type ThresholdSet,
  type YearGroupSource,
} from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useAnnounce } from "../app/announcer";
import { PageHeader } from "../components/Metric";
import { ErrorState, Loading, Notice } from "../components/States";
import { Icon } from "../components/Icon";
import { saveBlob } from "../lib/figureFiles";

/**
 * Scoring settings: how each instrument is scored, what its bands and
 * benchmarks are, and how sittings are grouped into schools and year groups.
 * Everyone can read it — a score is only as good as its definition — and
 * administrators change it. Every change is a new, kept version, with a reason;
 * nothing is overwritten.
 */

const bump = (v: string) => {
  const [a, b] = v.split(".").map(Number);
  return `${a ?? 1}.${(b ?? 0) + 1}.0`;
};
const LEVELS: { value: string; label: string }[] = [
  { value: "0", label: "No concern" },
  { value: "1", label: "Slight" },
  { value: "2", label: "High" },
  { value: "3", label: "Very high" },
  { value: "", label: "Descriptive" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function ScoringSettings() {
  const settings = useLoad<ScoringSettingsView>(() => api.getScoringSettings({}), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const data = settings.data;
  const current = data?.schemes.find((s) => s.scheme.key === selected) ?? null;
  return (
    <div className="page">
      <PageHeader
        title="Scoring"
        description="How each instrument is scored, the bands and benchmarks its scores are read against, and how sittings are grouped into schools and year groups. Every change is kept as a new version with who made it and why."
        actions={
          <Link className="btn btn-quiet" to="/scores">
            <Icon name="scores" size={16} /> Scores
          </Link>
        }
      />
      {settings.error ? <ErrorState message={settings.error.message} onRetry={() => void settings.reload()} /> : null}
      {!data && !settings.error ? <Loading /> : null}
      {data ? (
        <>
          {!data.canEdit ? <Notice>Read-only: scoring is changed by dashboard administrators.</Notice> : null}
          <SchemeList
            data={data}
            selected={selected}
            onSelect={(k) => {
              setSelected(k);
              setSaved(null);
            }}
          />
          {saved ? (
            <div role="status">
              <Notice>{saved}</Notice>
            </div>
          ) : null}
          {current ? (
            <SchemeEditor
              key={`${current.scheme.key}@${current.scheme.version}`}
              entry={current}
              data={data}
              onSaved={(text) => {
                setSaved(text);
                void settings.reload();
              }}
              onClose={() => {
                setSelected(null);
                setSaved(null);
              }}
            />
          ) : null}
          <GroupsCard data={data} onSaved={() => void settings.reload()} />
        </>
      ) : null}
    </div>
  );
}

function SchemeList({ data, selected, onSelect }: { data: ScoringSettingsView; selected: string | null; onSelect: (k: string) => void }) {
  return (
    <section className="card" aria-labelledby="schemes-h">
      <h2 id="schemes-h">Scoring schemes</h2>
      <p className="hint">
        The dashboard ships a scheme for each instrument the survey administers, following the published method where there is one. Each is marked verified once an
        administrator has checked it against the instrument's licensed scoring documents.
      </p>
      <div className="table-scroll">
        <table className="data compact">
          <caption className="sr-only">Scoring schemes</caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Method</th>
              <th scope="col">Version</th>
              <th scope="col">Verified</th>
              <th scope="col" className="num">
                Sittings
              </th>
              <th scope="col">Checks</th>
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.schemes.map((s) => {
              const errors = s.checks.flatMap((c) => c.issues).filter((i) => i.level === "error").length;
              const warnings = s.checks.flatMap((c) => c.issues).filter((i) => i.level === "warning").length;
              return (
                <tr key={s.scheme.key} className={selected === s.scheme.key ? "row-selected" : undefined}>
                  <th scope="row">
                    {s.scheme.abbreviation ?? s.scheme.name}
                    <div className="muted small">{s.scheme.abbreviation ? s.scheme.name : s.scheme.key}</div>
                  </th>
                  <td>{SCHEME_STATUS_LABELS[s.scheme.status]}</td>
                  <td>
                    v{s.scheme.version} <span className="muted small">{s.source === "study" ? (s.differsFromDefault ? "study's own" : "saved") : "dashboard default"}</span>
                  </td>
                  <td>{s.scheme.verified ? <span className="tag tag-good">{s.scheme.verified.by}</span> : <span className="tag tag-warn">Not yet</span>}</td>
                  <td className="num">{formatNumber(s.sittings)}</td>
                  <td>{errors ? <span className="tag tag-warn">{errors} error{errors === 1 ? "" : "s"}</span> : warnings ? <span className="tag tag-quiet">{warnings} note{warnings === 1 ? "" : "s"}</span> : <span className="muted">OK</span>}</td>
                  <td>
                    <button type="button" className="btn btn-small btn-quiet" onClick={() => onSelect(s.scheme.key)} aria-label={`Open the ${s.scheme.name} scheme`}>
                      {data.canEdit ? "Edit" : "View"} <Icon name="chevronRight" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── one scheme ────────────────────────────────────────────────────────────────

function SchemeEditor({ entry, data, onSaved, onClose }: { entry: SchemeSettingsView; data: ScoringSettingsView; onSaved: (message: string) => void; onClose: () => void }) {
  const announce = useAnnounce();
  const canEdit = data.canEdit;
  const [draft, setDraft] = useState<ScoringScheme>(() => ({ ...entry.scheme, version: bump(entry.scheme.version) }));
  const [json, setJson] = useState<string | null>(null);
  const toggleJson = () => setJson(json === null ? JSON.stringify(draft, null, 2) : null);
  const [reason, setReason] = useState("");
  const [verify, setVerify] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const [preview, setPreview] = useState<ScoresView | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const parsed = useMemo(() => parseScheme(draft), [draft]);
  const errors = "errors" in parsed ? parsed.errors : [];
  const def = data.defaults.find((d) => d.key === entry.scheme.key) ?? null;
  const changed = JSON.stringify({ ...draft, version: "" }) !== JSON.stringify({ ...entry.scheme, version: "" });
  useEffect(() => setPreview(null), [draft]);

  const updateOutput = (i: number, o: ScoreOutput) => setDraft({ ...draft, outputs: draft.outputs.map((x, j) => (j === i ? o : x)) });
  const run = async (kind: "preview" | "save") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "preview") {
        setPreview(await api.getScores({ draft, groupBy: "none", observation: "latest" }));
      } else {
        const r = await api.saveScoringScheme({ scheme: draft, reason, markVerified: verify, verifyNote });
        announce(`Saved ${r.key} version ${r.version}`);
        onSaved(`Saved ${r.key} v${r.version}. Scores, reports and exports use it from now on; every earlier version is kept.`);
      }
    } catch (e) {
      setMessage({ tone: "warn", text: explain(e).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card scheme-editor" aria-labelledby="editor-h">
      <div className="card-head">
        <div>
          <h2 id="editor-h">
            {entry.scheme.name} <span className="muted">v{entry.scheme.version}</span>
          </h2>
          <p className="card-desc">
            {entry.source === "study" ? `Saved by ${entry.savedBy ?? "?"}, ${dateTime(entry.savedAt)}${entry.reason ? `: “${entry.reason}”` : ""}.` : "The dashboard's default, not yet changed for this study."}
            {entry.scheme.verified ? ` Verified by ${entry.scheme.verified.by} on ${entry.scheme.verified.at.slice(0, 10)}${entry.scheme.verified.note ? ` (${entry.scheme.verified.note})` : ""}.` : " Not yet verified."}
          </p>
        </div>
        <div className="card-tools">
          <button type="button" className="btn btn-small btn-quiet" onClick={() => saveBlob(new Blob([JSON.stringify(entry.scheme, null, 2)], { type: "application/json" }), `scoring_${entry.scheme.key}_v${entry.scheme.version}.json`)}>
            <Icon name="download" size={14} /> JSON
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={onClose} aria-label="Close the editor">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      {entry.checks.some((c) => c.issues.length) ? (
        <Notice tone="warn">
          <ul className="plain-list">
            {entry.checks.flatMap((c) => c.issues.map((i, n) => <li key={`${c.version}-${n}`}>v{c.version}: {i.message}</li>))}
          </ul>
        </Notice>
      ) : null}

      <p className="scheme-method">{draft.method}</p>
      {draft.notes ? <p className="muted small">{draft.notes}</p> : null}

      {draft.outputs.map((o, i) => (
        <OutputEditor key={o.key} output={o} canEdit={canEdit} onChange={(no) => updateOutput(i, no)} />
      ))}

      <div className="advanced">
        <button type="button" className="disclosure" aria-expanded={json !== null} onClick={toggleJson}>
          <Icon name={json === null ? "chevronRight" : "chevronDown"} size={14} />
          {canEdit ? "Edit everything as JSON (items, reversals, re-codings, new scores)" : "The whole scheme as JSON"}
        </button>
        {json !== null ? (
          <>
            <textarea className="json-editor" rows={18} value={json} readOnly={!canEdit} spellCheck={false} onChange={(e) => setJson(e.target.value)} aria-label="Scheme JSON" />
            {canEdit ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  try {
                    setDraft(JSON.parse(json) as ScoringScheme);
                    setMessage(null);
                  } catch (e) {
                    setMessage({ tone: "warn", text: `That is not valid JSON: ${(e as Error).message}` });
                  }
                }}
              >
                Apply JSON
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {entry.history.length ? (
        <details className="advanced">
          <summary>Versions ({entry.history.length})</summary>
          <ul className="plain-list history">
            {entry.history.map((h) => (
              <li key={h.version}>
                <strong>v{h.version}</strong> — {h.savedBy ?? "?"}, {dateTime(h.savedAt)}
                {h.verified ? " · verified" : ""}
                {h.reason ? <div className="muted small">{h.reason}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canEdit ? (
        <div className="save-block">
          {errors.length ? (
            <Notice tone="warn">
              <ul className="plain-list">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="field-row">
            <label>
              New version
              <input type="text" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} spellCheck={false} />
            </label>
            <label className="grow">
              Why (kept with the version)
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cut-offs checked against the youthinmind scoring sheet" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            I have checked this scheme against the instrument's licensed scoring documents
          </label>
          {verify ? (
            <label>
              What was checked (optional)
              <input type="text" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="e.g. youthinmind 'Scoring the SDQ', 2016 edition" />
            </label>
          ) : null}
          <div className="export-row">
            <button type="button" className="btn" disabled={busy !== null || errors.length > 0} onClick={() => void run("preview")}>
              Preview the effect
            </button>
            <button type="button" className="btn btn-primary" disabled={busy !== null || errors.length > 0 || reason.trim().length < 3 || (!changed && !verify)} onClick={() => void run("save")}>
              Save v{draft.version}
            </button>
            {def ? (
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => setDraft({ ...def, version: bump(entry.scheme.version) })}>
                Start again from the dashboard default
              </button>
            ) : null}
          </div>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {preview ? <PreviewTable before={entry.scheme} view={preview} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function PreviewTable({ before, view }: { before: ScoringScheme; view: ScoresView }) {
  const scheme = view.schemes[0]!;
  return (
    <div className="table-scroll">
      <table className="data compact">
        <caption>With this draft, over every participant's latest sitting (all filters off)</caption>
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col" className="num">
              n
            </th>
            <th scope="col" className="num">
              Mean
            </th>
            <th scope="col">Bands</th>
          </tr>
        </thead>
        <tbody>
          {scheme.outputs.map((o) => {
            const r = view.results.find((x) => x.output === o.key);
            const s = r?.overall;
            const t = o.thresholds[0];
            return (
              <tr key={o.key}>
                <th scope="row">
                  {o.label}
                  {!before.outputs.some((b) => b.key === o.key) ? <span className="tag tag-quiet">new</span> : null}
                </th>
                <td className="num">{s ? formatNumber(s.n) : "–"}</td>
                <td className="num">{s ? formatNumber(s.mean, Math.max(1, o.decimals)) : "–"}</td>
                <td>{s && t ? t.bands.map((b, i) => `${b.label} ${Math.round((s.bands[t.key]?.[i]?.share ?? 0) * 100)}%`).join(" · ") : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── one output: rules, thresholds and benchmarks ─────────────────────────────

function OutputEditor({ output: o, canEdit, onChange }: { output: ScoreOutput; canEdit: boolean; onChange: (o: ScoreOutput) => void }) {
  const calc = o.calc;
  const setThreshold = (i: number, t: ThresholdSet | null) => onChange({ ...o, thresholds: t ? o.thresholds.map((x, j) => (j === i ? t : x)) : o.thresholds.filter((_, j) => j !== i) });
  const setBenchmark = (i: number, b: ScoreBenchmark | null) => onChange({ ...o, benchmarks: b ? o.benchmarks.map((x, j) => (j === i ? b : x)) : o.benchmarks.filter((_, j) => j !== i) });
  return (
    <fieldset className="output-editor" disabled={!canEdit}>
      <legend>
        {o.label} <span className="muted small">({o.key})</span>
      </legend>
      <p className="small">
        {calc.op === "sum" || calc.op === "mean" ? (
          <>
            {calc.op === "sum" ? "Sum" : "Mean"} of {calc.items.join(", ")}.{" "}
          </>
        ) : calc.op === "item" ? (
          <>The answer to {calc.item}. </>
        ) : calc.op === "combine" ? (
          <>
            {calc.how === "difference" ? "Difference" : calc.how === "mean" ? "Mean" : "Sum"} of {calc.outputs.join(", ")}
            {calc.weights ? ` (weights ${calc.weights.join(", ")})` : ""}.{" "}
          </>
        ) : (
          <>{calc.output} converted with a published table. </>
        )}
        Range {o.range[0]} to {o.range[1]}; higher is {o.higherIs === "neutral" ? "neither better nor worse" : o.higherIs}.
      </p>
      {calc.op === "sum" || calc.op === "mean" ? (
        <div className="field-row">
          <label>
            Items needed
            <input type="number" min={1} max={calc.items.length} value={calc.minValid} onChange={(e) => onChange({ ...o, calc: { ...calc, minValid: Number(e.target.value) } })} />
          </label>
          {calc.op === "sum" ? (
            <label className="check">
              <input type="checkbox" checked={calc.prorate} onChange={(e) => onChange({ ...o, calc: { ...calc, prorate: e.target.checked } })} />
              Prorate a partial sum (mean of the items answered × {calc.items.length}, rounded)
            </label>
          ) : null}
        </div>
      ) : null}

      {o.thresholds.map((t, i) => (
        <ThresholdEditor key={t.key} set={t} output={o} onChange={(nt) => setThreshold(i, nt)} canEdit={canEdit} />
      ))}
      {o.benchmarks.map((b, i) => (
        <BenchmarkEditor key={b.key} bench={b} onChange={(nb) => setBenchmark(i, nb)} canEdit={canEdit} />
      ))}
      {canEdit ? (
        <div className="export-row">
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() =>
              onChange({
                ...o,
                thresholds: [
                  ...o.thresholds,
                  { key: `study_${o.thresholds.length + 1}`, label: "Study bands", basis: "study", source: "", verified: false, bands: [{ label: "Lower", max: (o.range[0] + o.range[1]) / 2, level: 0 }, { label: "Higher", max: null, level: 2 }] },
                ],
              })
            }
          >
            <Icon name="plus" size={14} /> Add threshold bands
          </button>
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() => onChange({ ...o, benchmarks: [...o.benchmarks, { key: `benchmark_${o.benchmarks.length + 1}`, label: "Reference", population: "", source: "", verified: false, mean: (o.range[0] + o.range[1]) / 2, sd: null, n: null }] })}
          >
            <Icon name="plus" size={14} /> Add a benchmark
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}

function ThresholdEditor({ set, output, onChange, canEdit }: { set: ThresholdSet; output: ScoreOutput; onChange: (t: ThresholdSet | null) => void; canEdit: boolean }) {
  const setBand = (i: number, patch: Partial<ThresholdSet["bands"][number]>) => onChange({ ...set, bands: set.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <div className="threshold-editor">
      <div className="field-row">
        <label className="grow">
          Threshold bands
          <input type="text" value={set.label} onChange={(e) => onChange({ ...set, label: e.target.value })} />
        </label>
        <label>
          Basis
          <select value={set.basis} onChange={(e) => onChange({ ...set, basis: e.target.value as ThresholdSet["basis"] })}>
            {THRESHOLD_BASES.map((b) => (
              <option key={b} value={b}>
                {THRESHOLD_BASIS_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={set.verified} onChange={(e) => onChange({ ...set, verified: e.target.checked })} /> Checked against the source
        </label>
      </div>
      <label>
        Source
        <input type="text" value={set.source} onChange={(e) => onChange({ ...set, source: e.target.value })} />
      </label>
      <table className="data compact bands-table">
        <caption className="sr-only">Bands of {set.label}</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">Up to and including</th>
            <th scope="col">Concern</th>
            <th scope="col">Range shown</th>
            {set.expected ? <th scope="col">Expected %</th> : null}
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {set.bands.map((b, i) => (
            <tr key={i}>
              <td>
                <input type="text" value={b.label} onChange={(e) => setBand(i, { label: e.target.value })} aria-label={`Band ${i + 1} name`} />
              </td>
              <td>
                {b.max === null ? (
                  <span className="muted">top of the scale</span>
                ) : (
                  <input type="number" step="any" value={b.max} onChange={(e) => setBand(i, { max: Number(e.target.value) })} aria-label={`Band ${i + 1} upper limit`} />
                )}
              </td>
              <td>
                <select value={b.level === null ? "" : String(b.level)} onChange={(e) => setBand(i, { level: e.target.value === "" ? null : (Number(e.target.value) as 0 | 1 | 2 | 3) })} aria-label={`Band ${i + 1} concern`}>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="text" value={b.display ?? ""} placeholder={bandRange({ ...set, bands: set.bands.map(({ display: _d, ...x }) => x) }, i, output)} onChange={(e) => setBand(i, { display: e.target.value || undefined })} aria-label={`Band ${i + 1} range as written`} />
              </td>
              {set.expected ? (
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round((set.expected[i] ?? 0) * 1000) / 10}
                    onChange={(e) => onChange({ ...set, expected: set.expected!.map((x, j) => (j === i ? Number(e.target.value) / 100 : x)) })}
                    aria-label={`Band ${i + 1} expected share`}
                  />
                </td>
              ) : null}
              <td>
                {canEdit && set.bands.length > 2 ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove band ${b.label}`}
                    onClick={() => {
                      const bands = set.bands.filter((_, j) => j !== i).map((x, j, all) => (j === all.length - 1 ? { ...x, max: null } : x));
                      onChange({ ...set, bands, ...(set.expected ? { expected: undefined } : {}) });
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit ? (
        <div className="export-row">
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() => {
              const last = set.bands.at(-1)!;
              const prev = set.bands.at(-2)?.max ?? output.range[0];
              const mid = Math.round(((prev + output.range[1]) / 2) * 100) / 100;
              onChange({ ...set, bands: [...set.bands.slice(0, -1), { ...last, max: mid }, { label: "New band", max: null, level: last.level }], ...(set.expected ? { expected: undefined } : {}) });
            }}
          >
            <Icon name="plus" size={14} /> Add a band
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => onChange(null)}>
            <Icon name="trash" size={14} /> Remove these bands
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BenchmarkEditor({ bench, onChange, canEdit }: { bench: ScoreBenchmark; onChange: (b: ScoreBenchmark | null) => void; canEdit: boolean }) {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className="threshold-editor">
      <div className="field-row">
        <label className="grow">
          Benchmark
          <input type="text" value={bench.label} onChange={(e) => onChange({ ...bench, label: e.target.value })} />
        </label>
        <label>
          Mean
          <input type="number" step="any" value={bench.mean} onChange={(e) => onChange({ ...bench, mean: Number(e.target.value) })} />
        </label>
        <label>
          SD
          <input type="number" step="any" min={0} value={bench.sd ?? ""} onChange={(e) => onChange({ ...bench, sd: num(e.target.value) })} />
        </label>
        <label>
          n
          <input type="number" min={1} value={bench.n ?? ""} onChange={(e) => onChange({ ...bench, n: num(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={bench.verified} onChange={(e) => onChange({ ...bench, verified: e.target.checked })} /> Checked against the source
        </label>
      </div>
      <div className="field-row">
        <label className="grow">
          Population
          <input type="text" value={bench.population} onChange={(e) => onChange({ ...bench, population: e.target.value })} />
        </label>
        <label className="grow">
          Source
          <input type="text" value={bench.source} onChange={(e) => onChange({ ...bench, source: e.target.value })} />
        </label>
        {canEdit ? (
          <button type="button" className="icon-btn" aria-label={`Remove the benchmark ${bench.label}`} onClick={() => onChange(null)}>
            <Icon name="trash" size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── schools and year groups ───────────────────────────────────────────────────

function GroupsCard({ data, onSaved }: { data: ScoringSettingsView; onSaved: () => void }) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState<GroupSettings>(data.groups);
  const [rules, setRules] = useState(data.groups.yearGroup.rules.map((r) => `${r.pattern} = ${r.yearGroup}`).join("\n"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const canEdit = data.canEdit;
  const stats = data.groupStats;
  const parsedRules = rules
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.+?)\s*=\s*(\d{1,2})$/.exec(l);
      return m ? { pattern: m[1]!.trim(), yearGroup: Number(m[2]) } : null;
    });
  const badRules = parsedRules.filter((r) => r === null).length;
  const toggle = (s: YearGroupSource) => {
    const order = draft.yearGroup.order.includes(s) ? draft.yearGroup.order.filter((x) => x !== s) : YEAR_GROUP_SOURCES.filter((x) => x === s || draft.yearGroup.order.includes(x));
    setDraft({ ...draft, yearGroup: { ...draft.yearGroup, order } });
  };
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const settings: GroupSettings = { ...draft, yearGroup: { ...draft.yearGroup, rules: parsedRules.filter((r): r is { pattern: string; yearGroup: number } => r !== null) } };
      await api.saveGroupSettings({ settings, reason });
      setMessage({ tone: "info", text: "Saved. Scores and reports use these groups from now on." });
      announce("School and year-group settings saved");
      onSaved();
    } catch (e) {
      setMessage({ tone: "warn", text: explain(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="groups-h">
      <h2 id="groups-h">Schools and year groups</h2>
      <p className="hint">
        A sitting's school is the site its study code opens with. The survey does not ask for a year group, so it is taken from the first of these that gives one. Of{" "}
        {formatNumber(stats.sittings)} linked sittings: {YEAR_GROUP_SOURCES.map((s) => `${formatNumber(stats.yearGroupSources[s])} by ${YEAR_GROUP_SOURCE_LABELS[s].toLowerCase()}`).join(", ")}, and{" "}
        {formatNumber(stats.yearGroupSources.unknown)} unknown.
      </p>
      <fieldset className="check-list" disabled={!canEdit}>
        <legend>Year group comes from (in this order)</legend>
        {YEAR_GROUP_SOURCES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={draft.yearGroup.order.includes(s)} onChange={() => toggle(s)} /> {YEAR_GROUP_SOURCE_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <div className="settings-grid">
        <label>
          Study-code rules (one per line: <code>pattern = year</code>, e.g. <code>^NDC08 = 8</code>)
          <textarea rows={4} value={rules} onChange={(e) => setRules(e.target.value)} spellCheck={false} disabled={!canEdit} />
          {badRules ? <span className="hint warn-text">{badRules} line{badRules === 1 ? "" : "s"} not in the form “pattern = year”.</span> : null}
        </label>
        <label>
          Year-group question variable
          <input type="text" value={draft.yearGroup.itemVariable} onChange={(e) => setDraft({ ...draft, yearGroup: { ...draft.yearGroup, itemVariable: e.target.value } })} disabled={!canEdit} />
        </label>
        <label>
          School year starts in
          <select value={draft.yearGroup.startMonth} onChange={(e) => setDraft({ ...draft, yearGroup: { ...draft.yearGroup, startMonth: Number(e.target.value) } })} disabled={!canEdit}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
                {i === 8 ? " (England and Wales)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Smallest group to report on its own
          <input type="number" min={3} max={50} value={draft.minCell} onChange={(e) => setDraft({ ...draft, minCell: Number(e.target.value) })} disabled={!canEdit} />
          <span className="hint">Smaller groups are marked in the dashboard and left out of reports for schools.</span>
        </label>
      </div>
      <h3>School names</h3>
      <div className="table-scroll">
        <table className="data compact">
          <caption className="sr-only">Schools</caption>
          <thead>
            <tr>
              <th scope="col">Site code</th>
              <th scope="col" className="num">
                Sittings
              </th>
              <th scope="col">Name shown in scores and reports</th>
            </tr>
          </thead>
          <tbody>
            {stats.schools.map((s) => (
              <tr key={s.key}>
                <th scope="row">
                  <code>{s.key}</code>
                </th>
                <td className="num">{formatNumber(s.n)}</td>
                <td>
                  <input
                    type="text"
                    value={draft.schools[s.key] ?? ""}
                    placeholder={s.key}
                    disabled={!canEdit}
                    aria-label={`Name for ${s.key}`}
                    onChange={(e) => {
                      const schools = { ...draft.schools };
                      if (e.target.value.trim()) schools[s.key] = e.target.value;
                      else delete schools[s.key];
                      setDraft({ ...draft, schools });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="save-block">
          <label>
            Why (kept in the audit log)
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. School names from the fieldwork plan" />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 3 || badRules > 0 || draft.yearGroup.order.length === 0} onClick={() => void save()}>
            Save schools and year groups
          </button>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </div>
      ) : null}
    </section>
  );
}
