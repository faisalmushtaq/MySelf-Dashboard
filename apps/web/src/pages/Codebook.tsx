import { Fragment, useMemo, useState } from "react";
import { codebookCsvRows, QUALITY_AREA_LABELS, toCsv, type CodebookRow, type QualityFinding, type QualitySeverity } from "@myself-dashboard/core";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { Metric, PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { Icon } from "../components/Icon";

const SEVERITY_LABELS: Record<QualitySeverity, string> = { error: "Error", warning: "Warning", note: "Note" };
const STATUS_LABELS = { open: "To fix", fixed: "Fixed", decision: "Needs a decision" } as const;
const TYPE_LABELS: Record<string, string> = {
  single_choice: "Single choice",
  multi_choice: "Several options",
  checkbox_set: "Tick each statement",
  rank_group: "Sort and rank",
  numeric: "Number",
  slider: "Slider",
  ladder: "Ladder",
  text_short: "Short text",
  text_long: "Long text",
  form_fields: "Several short texts",
  date: "Date",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const versionSpan = (v: string[]) => (v.length === 0 ? "—" : v.length === 1 ? `r${v[0]}` : `r${v[0]}–r${v[v.length - 1]} (${v.length})`);
const scoreText = (v: number | null) => (v === null ? "missing" : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ""));

/**
 * The codebook: every question's readable name and label beside its survey
 * variable, wording and codes, and what each answer scores under the study's
 * scoring schemes — with the quality review that checks all of it against the
 * labels, the published scoring keys and every earlier survey version.
 *
 * Built from the survey definitions alone: no answers are shown here.
 */
export default function Codebook() {
  const [release, setRelease] = useState<string | undefined>(undefined);
  const { data, error, loading, reload } = useLoad(() => api.getCodebook(release ? { release } : {}), [release]);
  const [severity, setSeverity] = useState<QualitySeverity | "all">("all");
  const [search, setSearch] = useState("");
  const [instrument, setInstrument] = useState("");
  const [focus, setFocus] = useState<{ title: string; keys: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const findingById = useMemo(() => new Map((data?.findings ?? []).map((f) => [f.id, f])), [data]);
  const instruments = useMemo(() => [...new Map((data?.rows ?? []).map((r) => [r.instrument, r.section])).entries()], [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keys = focus ? new Set(focus.keys) : null;
    return (data?.rows ?? []).filter(
      (r) =>
        (!keys || keys.has(r.key)) &&
        (!instrument || r.instrument === instrument) &&
        (!q || [r.name, r.label, r.text, r.variable, r.legacyVariable ?? "", r.key].some((x) => x.toLowerCase().includes(q))),
    );
  }, [data, search, instrument, focus]);
  const findings = useMemo(() => (data?.findings ?? []).filter((f) => severity === "all" || f.severity === severity), [data, severity]);
  const nameOf = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.key, r.name])), [data]);

  const download = () => {
    if (!data) return;
    const { headers, rows: body } = codebookCsvRows(data.rows);
    const blob = new Blob([toCsv(headers, body, { bom: true })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `myself_codebook_r${data.release.version}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const showQuestions = (f: QualityFinding) => {
    setFocus({ title: f.title, keys: f.keys });
    setSearch("");
    setInstrument("");
    document.getElementById("codebook-questions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const named = data?.rows.filter((r) => r.named).length ?? 0;
  return (
    <div className="page">
      <PageHeader
        title="Codebook"
        description="Every question's readable name and label, its wording and codes, and what each answer scores — with an automatic review of every survey version against its labels, the published scoring keys and the study's scoring."
        actions={
          data ? (
            <>
              <label className="inline-select">
                Survey version
                <select value={data.release.hash} onChange={(e) => setRelease(e.target.value)} disabled={loading}>
                  {data.releases.map((r) => (
                    <option key={r.hash} value={r.hash}>
                      v{r.version}
                      {r.active ? " (live)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={download}>
                <Icon name="download" size={16} /> Codebook (CSV)
              </button>
            </>
          ) : null
        }
      />
      {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : null}
      {!data && !error ? <Loading label="Reviewing the survey versions" /> : null}
      {data ? (
        <>
          <section className="metric-grid" aria-label="The review in numbers">
            <Metric label="Questions" value={data.rows.length.toLocaleString("en-GB")} sub={`${named === data.rows.length ? "all" : named} with a readable name`} definition="Questions (not information screens) in this survey version. Each has a readable name and label for analysis; the survey's own variable is kept beside it." />
            <Metric label="Errors" value={data.counts.error.toLocaleString("en-GB")} tone={data.counts.error ? "warn" : undefined} sub={data.counts.error ? "scores or names are wrong" : "none"} definition="A score that does not match its labels or its published key, a code shared by two options, a question with no name: fix before analysis." />
            <Metric label="Warnings" value={data.counts.warning.toLocaleString("en-GB")} sub="need a decision or care" definition="Things that change what the data mean or how they may be pooled, and that someone has to decide on." />
            <Metric label="Notes" value={data.counts.note.toLocaleString("en-GB")} sub="worth knowing" definition="Changes between versions, wording that differs slightly from a published form, and scale conventions to know about." />
          </section>

          <section className="card" aria-labelledby="qc-title">
            <div className="section-head">
              <h2 id="qc-title">Quality review</h2>
              <div className="segmented" role="group" aria-label="Show">
                {(["all", "error", "warning", "note"] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)}>
                    {s === "all" ? `All (${data.findings.length})` : `${SEVERITY_LABELS[s]}s (${data.counts[s]})`}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted-note">
              Checked against every survey version ({data.releases.length}) and the study&apos;s current scoring schemes. What is checked, and the sources, are in the handover
              documentation (docs/09).
            </p>
            {findings.length === 0 ? <EmptyState icon="check" title="Nothing to show" /> : null}
            <ul className="findings">
              {findings.map((f) => (
                <li key={f.id} className={`finding sev-${f.severity}`}>
                  <div className="finding-head">
                    <span className={`tag sev-tag sev-${f.severity}`}>
                      <Icon name={f.severity === "note" ? "info" : "alert"} size={13} /> {SEVERITY_LABELS[f.severity]}
                    </span>
                    <span className="tag tag-quiet">{QUALITY_AREA_LABELS[f.area]}</span>
                    {f.status ? <span className={`tag ${f.status === "fixed" ? "tag-good" : "tag-quiet"}`}>{STATUS_LABELS[f.status]}</span> : null}
                    <strong className="finding-title">{f.title}</strong>
                  </div>
                  <p className="finding-detail">{f.detail}</p>
                  <p className="muted-note finding-meta">
                    {f.versions?.length ? <>Survey {f.versions.length > 3 ? versionSpan(f.versions) : f.versions.map((v) => `r${v}`).join(", ")}. </> : null}
                    {f.source ? <>Source: {f.source} </> : null}
                    {f.keys.length ? (
                      <button type="button" className="btn-link" onClick={() => showQuestions(f)}>
                        Show {f.keys.length === 1 ? nameOf.get(f.keys[0]!) ?? "the question" : plural(f.keys.length, "question")}
                      </button>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="codebook-questions-title" id="codebook-questions">
            <div className="section-head">
              <h2 id="codebook-questions-title">Questions in v{data.release.version}</h2>
            </div>
            <div className="filter-row" role="search">
              <label className="inline-select">
                Find
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, label, wording or variable" autoComplete="off" spellCheck={false} />
              </label>
              <label className="inline-select">
                Instrument
                <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                  <option value="">All</option>
                  {instruments.map(([key, section]) => (
                    <option key={key} value={key}>
                      {section} ({key})
                    </option>
                  ))}
                </select>
              </label>
              {focus ? (
                <span className="chip">
                  {focus.title.length > 60 ? `${focus.title.slice(0, 59)}…` : focus.title}
                  <button type="button" aria-label="Show every question" onClick={() => setFocus(null)}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ) : null}
              <span className="muted-note">{plural(rows.length, "question")}</span>
            </div>
            <div className="table-scroll">
              <table className="data codebook">
                <caption className="sr-only">Questions in survey version {data.release.version}, with their readable names, answers and scoring</caption>
                <thead>
                  <tr>
                    <th scope="col">Name and label</th>
                    <th scope="col">Answer</th>
                    <th scope="col">Scored in</th>
                    <th scope="col">Asked in</th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.key}>
                      <tr>
                        <th scope="row">
                          <button type="button" className="row-toggle" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>
                            <Icon name={open === r.key ? "up" : "down"} size={14} />
                            <code>{r.name}</code>
                          </button>
                          <div className="codebook-label">{r.label}</div>
                          {r.identifying ? (
                            <span className="tag tag-quiet">
                              <Icon name="lock" size={12} /> identifying — never exported with answers
                            </span>
                          ) : null}
                        </th>
                        <td>
                          {TYPE_LABELS[r.responseType] ?? r.responseType}
                          {r.options.length ? <span className="muted"> · {plural(r.options.length, "option")}</span> : null}
                          {r.unit ? <span className="muted"> · {r.unit}</span> : null}
                        </td>
                        <td>
                          <span className="tags">
                            {r.scoring.map((u) => (
                              <span key={`${u.scheme}.${u.output}`} className="tag tag-quiet" title={`${u.schemeName} v${u.schemeVersion}`}>
                                {u.schemeName}: {u.outputLabel}
                                {u.transform ? ` (${u.transform})` : ""}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="nowrap">{versionSpan(r.versions)}</td>
                        <td>
                          {r.findings.length ? (
                            <span className="tags">
                              {[...new Set(r.findings.map((id) => findingById.get(id)?.severity).filter((s): s is QualitySeverity => !!s))].map((s) => (
                                <span key={s} className={`tag sev-tag sev-${s}`}>
                                  {plural(r.findings.filter((id) => findingById.get(id)?.severity === s).length, SEVERITY_LABELS[s].toLowerCase())}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                      {open === r.key ? (
                        <tr className="subrow">
                          <td colSpan={5}>
                            <QuestionDetail row={r} findings={r.findings.map((id) => findingById.get(id)).filter((f): f is QualityFinding => !!f)} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function QuestionDetail({ row: r, findings }: { row: CodebookRow; findings: QualityFinding[] }) {
  return (
    <div className="codebook-detail">
      <dl className="kv">
        <div>
          <dt>Wording</dt>
          <dd>
            {r.lede ? <p className="muted codebook-lede">{r.lede}</p> : null}
            {r.text}
          </dd>
        </div>
        {r.instructions ? (
          <div>
            <dt>Instructions</dt>
            <dd>{r.instructions}</dd>
          </div>
        ) : null}
        <div>
          <dt>Survey variable</dt>
          <dd>
            <code>{r.variable}</code>
            {r.legacyVariable ? (
              <>
                {" "}
                · Qualtrics <code>{r.legacyVariable}</code>
              </>
            ) : null}{" "}
            · key <code>{r.key}</code>
          </dd>
        </div>
        <div>
          <dt>Asked</dt>
          <dd>
            {r.section}; {r.required === "hard" ? "must be answered" : r.required === "soft" ? "prompted once if skipped" : "optional"}
            {r.conditional ? "; only when its condition is met" : ""}
          </dd>
        </div>
        {r.researcherNote ? (
          <div>
            <dt>Survey note</dt>
            <dd>{r.researcherNote}</dd>
          </div>
        ) : null}
      </dl>
      {r.options.length ? (
        <table className="data compact codebook-codes">
          <caption className="sr-only">Codes, labels and scores for {r.name}</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Label</th>
              {r.scoring.map((u) => (
                <th key={`${u.scheme}.${u.output}`} scope="col" className="num">
                  {u.schemeName}: {u.outputLabel}
                  {u.transform ? ` (${u.transform})` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.options.map((o, i) => (
              <tr key={o.code}>
                <td className="num">{o.code}</td>
                <td>
                  {o.label}
                  {o.kind !== "substantive" ? <span className="tag tag-quiet">{o.kind.replace(/_/g, " ")} — not scored</span> : null}
                  {o.value !== undefined ? <span className="muted"> (stands for {o.value})</span> : null}
                </td>
                {r.scoring.map((u) => (
                  <td key={`${u.scheme}.${u.output}`} className="num">
                    {u.values ? scoreText(u.values[i] ?? null) : "as answered"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : r.scoring.length ? (
        <p className="muted-note">Scored as the number answered: {r.scoring.map((u) => `${u.schemeName} ${u.outputLabel}`).join("; ")}.</p>
      ) : null}
      {findings.length ? (
        <ul className="tight">
          {findings.map((f) => (
            <li key={f.id}>
              <span className={`tag sev-tag sev-${f.severity}`}>{SEVERITY_LABELS[f.severity]}</span> {f.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
