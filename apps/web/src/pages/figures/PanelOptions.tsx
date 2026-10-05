import type { PanelSpec, QuestionData, ScoringScheme } from "@myself-dashboard/core";

/** Figures (../Figures.tsx): the options under one panel, which depend on what the panel shows. */

export function PanelOptions({
  panel,
  effectiveVersion,
  questions,
  releases,
  onChange,
  schemes,
}: {
  panel: PanelSpec;
  effectiveVersion: string;
  questions: Record<string, QuestionData>;
  releases: { hash: string; version: string }[];
  onChange: (p: PanelSpec) => void;
  schemes: ScoringScheme[];
}) {
  if (panel.kind === "score_distribution" || panel.kind === "score_groups" || panel.kind === "score_bands") {
    const scheme = schemes.find((s) => s.key === panel.scheme) ?? schemes[0];
    const output = scheme?.outputs.find((o) => o.key === panel.output) ?? scheme?.outputs.find((o) => o.primary) ?? scheme?.outputs[0];
    return (
      <div className="panel-options">
        <label>
          Instrument
          <select value={scheme?.key ?? ""} onChange={(e) => onChange({ ...panel, scheme: e.target.value, output: "", ...("thresholds" in panel ? { thresholds: "" } : {}), ...("benchmark" in panel ? { benchmark: "" } : {}) })}>
            {schemes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.abbreviation ?? s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Score
          <select value={output?.key ?? ""} onChange={(e) => onChange({ ...panel, output: e.target.value })}>
            {(scheme?.outputs ?? []).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {"thresholds" in panel && output?.thresholds.length ? (
          <label>
            Bands
            <select value={panel.thresholds} onChange={(e) => onChange({ ...panel, thresholds: e.target.value })}>
              {output.thresholds.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
              {panel.kind === "score_distribution" ? <option value="none">None</option> : null}
            </select>
          </label>
        ) : null}
        {"benchmark" in panel && output?.benchmarks.length ? (
          <label>
            Benchmark
            <select value={panel.benchmark} onChange={(e) => onChange({ ...panel, benchmark: e.target.value })}>
              {output.benchmarks.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
              <option value="none">None</option>
            </select>
          </label>
        ) : null}
        <p className="hint">Grouped and counted as on the Scores page.</p>
      </div>
    );
  }
  const versionSelect = (value: string, set: (v: string) => void) => (
    <label>
      Survey version
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Follow the version filter</option>
        {releases.map((r) => (
          <option key={r.hash} value={r.hash}>
            v{r.version}
          </option>
        ))}
      </select>
    </label>
  );
  const stats = questions[effectiveVersion]?.stats ?? [];
  switch (panel.kind) {
    case "participation":
      return (
        <div className="panel-options">
          <label className="check">
            <input type="checkbox" checked={panel.cumulative} onChange={(e) => onChange({ ...panel, cumulative: e.target.checked })} />
            Cumulative totals
          </label>
        </div>
      );
    case "completion":
      return (
        <div className="panel-options">
          <label>
            Compare
            <select value={panel.group} onChange={(e) => onChange({ ...panel, group: e.target.value as "version" | "site" })}>
              <option value="version">Survey versions</option>
              <option value="site">Sites</option>
            </select>
          </label>
          {panel.group === "site" ? (
            <label>
              Site labels
              <select value={panel.siteLabels} onChange={(e) => onChange({ ...panel, siteLabels: e.target.value as "anonymised" | "codes" })}>
                <option value="anonymised">Anonymised (Site 1, 2…)</option>
                <option value="codes">Site codes (not for publication)</option>
              </select>
            </label>
          ) : null}
        </div>
      );
    case "sections":
      return (
        <div className="panel-options">
          <label>
            Measure
            <select value={panel.measure} onChange={(e) => onChange({ ...panel, measure: e.target.value as "reached" | "completion" })}>
              <option value="reached">Sessions reaching each section</option>
              <option value="completion">Required answers given</option>
            </select>
          </label>
        </div>
      );
    case "items": {
      const sections = [...new Map(stats.map((q) => [q.sectionKey, q.sectionTitle])).entries()];
      return (
        <div className="panel-options">
          {versionSelect(panel.version, (v) => onChange({ ...panel, version: v, section: null }))}
          <label>
            Section
            <select value={panel.section ?? ""} onChange={(e) => onChange({ ...panel, section: e.target.value || null })}>
              <option value="">All sections</option>
              {sections.map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order
            <select value={panel.order} onChange={(e) => onChange({ ...panel, order: e.target.value as "lowest" | "questionnaire" })}>
              <option value="lowest">Lowest answered first</option>
              <option value="questionnaire">Questionnaire order</option>
            </select>
          </label>
          <label>
            Questions shown
            <input type="number" min={3} max={40} value={panel.limit} onChange={(e) => onChange({ ...panel, limit: Math.min(40, Math.max(3, Number(e.target.value) || 12)) })} />
          </label>
          <label>
            Label questions by
            <select value={panel.labels} onChange={(e) => onChange({ ...panel, labels: e.target.value as "text" | "label" | "variable" })}>
              <option value="text">Wording</option>
              <option value="label">Short label</option>
              <option value="variable">Variable name</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={panel.requiredOnly} onChange={(e) => onChange({ ...panel, requiredOnly: e.target.checked })} />
            Required questions only
          </label>
        </div>
      );
    }
    case "responses": {
      const choosable = stats.filter((q) => q.distribution.kind !== "none");
      return (
        <div className="panel-options">
          {versionSelect(panel.version, (v) => onChange({ ...panel, version: v, question: "" }))}
          <label className="wide">
            Question
            <select value={panel.question} onChange={(e) => onChange({ ...panel, question: e.target.value })}>
              <option value="">Choose a question…</option>
              {choosable.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.name} — {q.label}
                </option>
              ))}
            </select>
          </label>
          {stats.length && choosable.length < stats.length ? <p className="hint">Identifying and free-text questions are not offered: their answers are never aggregated.</p> : null}
        </div>
      );
    }
    default:
      return null;
  }
}
