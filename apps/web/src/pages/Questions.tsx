import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CHANGE_LABELS,
  compareVersions,
  OUTCOME_LABELS,
  type Compatibility,
  type QuestionAnalyticsResponse,
  type QuestionHistoryResponse,
  type QuestionStat,
} from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { int, pct } from "../lib/format";
import { useFilters, sessionsLink } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { useStudyData } from "../app/data";
import { PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Loading, Notice, Skeleton } from "../components/States";
import { Icon } from "../components/Icon";
import { Dialog } from "../components/Dialog";
import { BarList } from "../charts/BarList";
import { Columns } from "../charts/Columns";
import { ChartCard } from "../charts/ChartCard";

const COMPAT_LABEL: Record<Compatibility, string> = {
  compatible: "Comparable",
  caution: "Changed — compare with care",
  incompatible: "Not comparable",
};

function CompatBadge({ c }: { c: Compatibility }) {
  return (
    <span className={`badge compat-${c}`}>
      <Icon name={c === "compatible" ? "check" : c === "caution" ? "alert" : "ban"} size={13} />
      {COMPAT_LABEL[c]}
    </span>
  );
}

/**
 * Question-level analysis for ONE survey version at a time. Distributions are
 * counted by stored option code and labelled in that version's wording; the same
 * stable question can be followed across versions with every change called out.
 */
export default function Questions() {
  const { filters, params, setParams } = useFilters();
  const { byNewest, activeRelease, releasesLoaded } = useStudyData();
  const chosen = params.get("qv") ?? (filters.versions.length === 1 && filters.versions[0] !== "unknown" ? filters.versions[0]! : activeRelease?.hash ?? "");
  const idx = byNewest.findIndex((r) => r.hash === chosen);
  const defaultCompare = idx >= 0 ? byNewest[idx + 1]?.hash ?? "" : "";
  const compareWith = params.has("cmp") ? params.get("cmp")! : defaultCompare;
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);

  const set = (k: string, v: string | null) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v === null) p.delete(k);
      else p.set(k, v);
      return p;
    });

  const key = JSON.stringify({ filters, chosen, compareWith });
  const { data, error, loading, reload } = useLoad<QuestionAnalyticsResponse>(
    () => api.getQuestionAnalytics({ filters, versionHash: chosen, compareWith: compareWith || null }),
    [key],
    { enabled: !!chosen },
  );

  const changed = new Map(data?.comparison?.changed.map((c) => [c.key, c]) ?? []);
  const added = new Set(data?.comparison?.added.map((a) => a.key) ?? []);
  const vFilters = { ...filters, versions: [chosen] };
  const link = (patch: Parameters<typeof sessionsLink>[1]) => sessionsLink(vFilters, patch);

  const sections: { key: string; title: string; stats: QuestionStat[] }[] = [];
  for (const s of data?.stats ?? []) {
    const last = sections[sections.length - 1];
    if (last && last.key === s.sectionKey) last.stats.push(s);
    else sections.push({ key: s.sectionKey, title: s.sectionTitle, stats: [s] });
  }

  return (
    <div className="page">
      <PageHeader title="Questions" description="Question-level response, completion and answer distributions for one survey version, with changes between versions." />
      <div className="version-pickers card">
        <label>
          Survey version
          <select value={chosen} onChange={(e) => { set("qv", e.target.value); set("cmp", null); }}>
            {byNewest.map((r) => (
              <option key={r.hash} value={r.hash}>
                v{r.version} — published {r.publishedAt.slice(0, 10)}
                {activeRelease?.hash === r.hash ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compare with
          <select value={compareWith} onChange={(e) => set("cmp", e.target.value)}>
            <option value="">No comparison</option>
            {byNewest
              .filter((r) => r.hash !== chosen)
              .map((r) => (
                <option key={r.hash} value={r.hash}>
                  v{r.version}
                </option>
              ))}
          </select>
        </label>
        <p className="hint">Only sessions collected under the chosen version are counted here. Other filters below still apply.</p>
      </div>
      <FilterBar />
      {!releasesLoaded ? <Loading label="Loading survey versions" /> : null}
      {releasesLoaded && byNewest.length === 0 ? (
        <EmptyState icon="reports" title="No survey versions are registered">
          An administrator registers published releases in Settings (or with scripts/sync-releases.mjs). Until then questions cannot be analysed.
        </EmptyState>
      ) : null}
      {error && !data ? <ErrorState title="Question analysis could not be calculated" message={error.message} onRetry={reload} /> : null}
      {!data && !error && chosen ? <Skeleton lines={10} /> : null}

      {data ? (
        <div className={loading ? "dimmed" : ""} aria-busy={loading}>
          {data.comparison ? (
            <section className="card comparison" aria-label="Changes between versions">
              <h3>
                v{data.comparison.from.version} → v{data.comparison.to.version}
              </h3>
              <p>
                {int(data.comparison.added.length)} added · {int(data.comparison.removed.length)} removed · {int(data.comparison.changed.length)} changed ·{" "}
                {int(data.comparison.unchanged)} unchanged. Questions are matched only by their stable ID.
              </p>
              {data.comparison.changed.filter((c) => c.compatibility !== "compatible").length ? (
                <ul className="change-list">
                  {data.comparison.changed
                    .filter((c) => c.compatibility !== "compatible")
                    .map((c) => (
                      <li key={c.key}>
                        <CompatBadge c={c.compatibility} /> <code>{c.key}</code> {c.details.join("; ")}
                      </li>
                    ))}
                </ul>
              ) : null}
              {data.comparison.removed.length ? (
                <details>
                  <summary>Removed in the later version ({data.comparison.removed.length})</summary>
                  <ul>
                    {data.comparison.removed.map((r) => (
                      <li key={r.key}>
                        <code>{r.key}</code> {r.text}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

          {data.sessions === 0 ? (
            <Notice>No sessions under v{data.release.version} match these filters. The questions are listed with no responses.</Notice>
          ) : (
            <p className="result-count">
              <strong>{int(data.sessions)}</strong> session{data.sessions === 1 ? "" : "s"} under v{data.release.version}
            </p>
          )}

          <div className="table-scroll">
            <table className="data questions-table">
              <caption className="sr-only">Questions in survey version {data.release.version}</caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Type</th>
                  <th scope="col">Required</th>
                  <th scope="col" className="num">Eligible</th>
                  <th scope="col" className="num">Shown</th>
                  <th scope="col" className="num">Answered</th>
                  <th scope="col" className="num">Unanswered</th>
                  <th scope="col" className="num">Response rate</th>
                  <th scope="col" className="num">Invalid</th>
                  <th scope="col" className="num">Drop-offs</th>
                  <th scope="col">Change</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => (
                  <Fragment key={sec.key}>
                    <tr className="group-row">
                      <th scope="colgroup" colSpan={12}>
                        {sec.title}
                      </th>
                    </tr>
                    {sec.stats.map((s) => (
                      <Fragment key={s.key}>
                        <tr>
                          <td className="q-cell">
                            <code>{s.key}</code>
                            <span className="q-text">{s.text}</span>
                            {s.identifying ? <span className="tag tag-quiet"><Icon name="lock" size={12} /> Identifying</span> : null}
                            {s.conditional ? <span className="tag tag-quiet">Conditional</span> : null}
                          </td>
                          <td>{s.responseType.replace("_", " ")}</td>
                          <td>{s.countsAsRequired ? s.required : <span className="muted">{s.required}</span>}</td>
                          <td className="num">
                            {int(s.eligible)}
                            {s.undetermined ? <span className="muted" title="Eligibility unknown"> +{s.undetermined}?</span> : null}
                          </td>
                          <td className="num">{int(s.shown)}</td>
                          <td className="num">{int(s.answered)}</td>
                          <td className="num">{s.unanswered ? <Link to={link({ questionKey: s.key, questionOutcomes: ["skipped", "no_response", "not_reached", "eligible_not_shown", "invalid"] })}>{int(s.unanswered)}</Link> : "0"}</td>
                          <td className="num">{pct(s.responseRate)}</td>
                          <td className="num">{s.invalid ? <Link to={link({ questionKey: s.key, questionOutcomes: ["invalid"] })}>{int(s.invalid)}</Link> : "0"}</td>
                          <td className="num">{s.dropOffs ? <Link to={link({ dropOffKey: s.key })}>{int(s.dropOffs)}</Link> : "0"}</td>
                          <td>{added.has(s.key) ? <span className="badge compat-new">New in this version</span> : changed.get(s.key) ? <CompatBadge c={changed.get(s.key)!.compatibility} /> : null}</td>
                          <td>
                            <button type="button" className="btn btn-small btn-quiet" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>
                              {open === s.key ? "Hide" : "Details"}
                            </button>
                          </td>
                        </tr>
                        {open === s.key ? (
                          <tr className="detail-row">
                            <td colSpan={12}>
                              <QuestionDetail stat={s} link={link} onHistory={() => setHistory(s.key)} changeDetails={changed.get(s.key)?.details ?? []} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <HistoryDialog questionKey={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function QuestionDetail({ stat: s, link, onHistory, changeDetails }: { stat: QuestionStat; link: (p: Parameters<typeof sessionsLink>[1]) => string; onHistory: () => void; changeDetails: string[] }) {
  const d = s.distribution;
  const outcomes: [keyof QuestionStat, string][] = [
    ["answered", "answered"],
    ["declined", "declined"],
    ["skipped", "skipped"],
    ["noResponse", "no_response"],
    ["notReached", "not_reached"],
    ["eligibleNotShown", "eligible_not_shown"],
    ["invalid", "invalid"],
    ["hiddenBranching", "hidden_branching"],
    ["answeredHidden", "answered_hidden"],
    ["undetermined", "undetermined"],
  ];
  return (
    <div className="q-detail">
      <div>
        <h4>What happened to this question</h4>
        <BarList
          ariaLabel={`Outcomes for ${s.key}`}
          max={Math.max(1, s.sessions)}
          items={outcomes
            .filter(([k]) => (s[k] as number) > 0)
            .map(([k, o]) => ({
              key: o,
              text: OUTCOME_LABELS[o as keyof typeof OUTCOME_LABELS],
              label: OUTCOME_LABELS[o as keyof typeof OUTCOME_LABELS],
              value: s[k] as number,
              display: int(s[k] as number),
              href: link({ questionKey: s.key, questionOutcomes: [o as never] }),
              color: o === "answered" || o === "declined" ? "var(--viz-accent)" : "var(--viz-muted)",
            }))}
        />
        <p className="hint">Coverage (answered ÷ eligible): {pct(s.coverage)}. Response rate (answered ÷ shown): {pct(s.responseRate)}.</p>
        <button type="button" className="btn btn-small" onClick={onHistory}>
          <Icon name="reports" size={14} /> History across versions
        </button>
        {changeDetails.length ? <Notice tone="warn">Changed since the comparison version: {changeDetails.join("; ")}</Notice> : null}
      </div>
      <div>
        <h4>Answers</h4>
        {d.kind === "none" ? <p className="hint">{d.reason}</p> : null}
        {d.kind === "options" ? (
          <ChartCard
            id={`dist-${s.key}`}
            title={d.multi ? "Options chosen (a session can choose several)" : "Answers by option"}
            description={`${int(d.total)} answered sessions. Counted by stored code, labelled in this version's wording.`}
            table={{ columns: ["Code", "Label", "Sessions"], rows: [...d.options.map((o) => [o.code, o.label, o.count]), ...d.unknownCodes.map((u) => [u.code, "(not in this version)", u.count])] }}
          >
            <BarList
              ariaLabel={`Answer distribution for ${s.key}`}
              max={Math.max(1, d.total)}
              items={d.options.map((o) => ({ key: String(o.code), text: `${o.label} (code ${o.code})`, label: <>{o.label} <span className="code">{o.code}</span></>, value: o.count, display: `${int(o.count)} · ${pct(d.total ? o.count / d.total : null)}` }))}
            />
          </ChartCard>
        ) : null}
        {d.kind === "numeric" ? (
          <ChartCard
            id={`dist-${s.key}`}
            title="Distribution of answers"
            description={`${int(d.total)} answers · median ${d.median ?? "—"} · mean ${d.mean === null ? "—" : d.mean.toFixed(1)}`}
            table={{ columns: ["Range", "Sessions"], rows: d.bins.map((b) => [b.label, b.count]) }}
          >
            <Columns ariaLabel={`Distribution of answers to ${s.key}`} bins={d.bins.map((b) => ({ label: b.label, value: b.count }))} />
          </ChartCard>
        ) : null}
      </div>
    </div>
  );
}

function HistoryDialog({ questionKey, onClose }: { questionKey: string | null; onClose: () => void }) {
  const [data, setData] = useState<QuestionHistoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!questionKey) return;
    let cancelled = false;
    setData(null);
    setErr(null);
    api
      .getQuestionHistory({ key: questionKey })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(explain(e).message));
    return () => {
      cancelled = true;
    };
  }, [questionKey]);
  const entries = data ? [...data.entries].sort((a, b) => compareVersions(b.version, a.version)) : [];
  return (
    <Dialog open={questionKey !== null} onClose={onClose} title={`History of ${questionKey ?? ""}`} wide>
      {err ? <Notice tone="warn">{err}</Notice> : null}
      {!data && !err ? <Loading /> : null}
      {data ? (
        <table className="data">
          <caption className="sr-only">This question in every survey version</caption>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Wording</th>
              <th scope="col">Type / required</th>
              <th scope="col">Options (code = label)</th>
              <th scope="col">Change from previous</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.hash}>
                <th scope="row">v{e.version}</th>
                {e.present && e.question ? (
                  <>
                    <td>{e.question.text}</td>
                    <td>
                      {e.question.responseType.replace("_", " ")} · {e.question.required}
                      {e.question.conditional ? " · conditional" : ""}
                    </td>
                    <td className="small">{e.question.options?.map((o) => `${o.code} = ${o.label}`).join("; ") ?? "—"}</td>
                    <td>
                      {e.changes.length ? (
                        <>
                          <CompatBadge c={e.compatibility} />
                          <ul className="small">
                            {e.changes.map((c, i) => (
                              <li key={c}>{e.details[i] ?? CHANGE_LABELS[c]}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="muted">
                    Not in this version (never collected)
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Dialog>
  );
}
