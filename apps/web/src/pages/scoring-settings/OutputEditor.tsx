import { bandRange, THRESHOLD_BASIS_LABELS, THRESHOLD_BASES, type ScoreBenchmark, type ScoreOutput, type ThresholdSet } from "@myself-dashboard/core";
import { Icon } from "../../components/Icon";

/** Scoring settings (../ScoringSettings.tsx): one score's rules, threshold bands and benchmarks. */

const LEVELS: { value: string; label: string }[] = [
  { value: "0", label: "No concern" },
  { value: "1", label: "Slight" },
  { value: "2", label: "High" },
  { value: "3", label: "Very high" },
  { value: "", label: "Descriptive" },
];

// ── one output: rules, thresholds and benchmarks ─────────────────────────────

export function OutputEditor({ output: o, canEdit, onChange }: { output: ScoreOutput; canEdit: boolean; onChange: (o: ScoreOutput) => void }) {
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
