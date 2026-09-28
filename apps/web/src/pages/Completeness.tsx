import { Link } from "react-router-dom";
import { int, pct, shortDay } from "../lib/format";
import { useFilters, sessionsLink, filterQuery } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { useAuth } from "../app/auth";
import { Metric, PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/States";
import { ChartCard } from "../charts/ChartCard";
import { BarList } from "../charts/BarList";
import { LineChart } from "../charts/LineChart";
import { periodLabel, useAnalytics } from "./Overview";
import { HelpContent } from "./Help";
import { useState } from "react";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";

/**
 * Completeness, judged against each session's own survey version
 * (docs/03-completeness.md). Every figure links to the sessions behind it.
 */
export default function Completeness() {
  const { filters, params } = useFilters();
  const { me } = useAuth();
  const { data, error, loading, reload } = useAnalytics();
  const [defs, setDefs] = useState(false);
  const a = data?.analytics;
  const m = a?.metrics;
  const link = (patch: Parameters<typeof sessionsLink>[1]) => sessionsLink(filters, patch);
  const levels = me?.policy?.requiredLevels.join(" and ") ?? "hard and soft";

  return (
    <div className="page">
      <PageHeader
        title="Completeness"
        description={<>How complete the data are, question by question, judged against the survey version each participant received — {periodLabel(filters)}.</>}
        actions={
          <button type="button" className="btn btn-quiet" onClick={() => setDefs(true)}>
            <Icon name="help" size={16} /> How completeness is calculated
          </button>
        }
      />
      <section className="card formula-card" aria-label="Definition">
        <p className="formula">Required completion = required questions answered or declined ÷ required questions that applied to the participant</p>
        <p className="hint">
          Required means {levels}-required under the study policy. Questions hidden by the survey's skip logic are not counted as missing; results that depend on
          answers never reached are marked ≈ (estimated). Sessions whose version is unknown are shown as unavailable, never guessed.
        </p>
      </section>
      <FilterBar />
      {error && !data ? <ErrorState title="Completeness could not be calculated" message={error.message} onRetry={reload} /> : null}
      {!data && !error ? <Skeleton lines={8} /> : null}
      {a && m && m.started === 0 ? <EmptyState icon="filter" title="No sessions match these filters">Widen the date range or remove a filter.</EmptyState> : null}
      {a && m && m.started > 0 ? (
        <div className={loading ? "dimmed" : ""} aria-busy={loading}>
          <section className="metric-grid" aria-label="Completeness figures">
            <Metric hero label="Mean required completion" value={pct(m.meanRequiredCompletion)} sub="Across sessions that reached the end" definition="The average of each finished session's required completion. Invalid sessions are excluded." />
            <Metric label="Overall completion rate" value={pct(m.completionRate)} definition="Complete ÷ (Complete + Incomplete + Abandoned)." href={link({ statuses: ["complete"] })} />
            <Metric label="Finished with gaps" value={int(m.incomplete)} definition="Reached the end with at least one missing required answer." href={link({ statuses: ["incomplete"] })} />
            <Metric label="Abandoned" value={int(m.abandoned)} definition="Not finished and not heard from within the abandonment window." href={link({ statuses: ["abandoned"] })} />
            <Metric label="Sessions with invalid answers" value={int(a.signals.find((s) => s.code === "invalid_answers")?.count ?? 0)} definition="Sessions with at least one recorded answer that does not fit its version's definition (unknown option code, out of range, corrupted)." href={link({ warning: "invalid_answers" })} />
            <Metric label="Estimated completeness" value={int(m.estimatedCount)} definition="Sessions whose completeness depends on questions the participant never reached, or whose log records no question presentations." />
            <Metric label="Completeness unavailable" value={int(m.unknownVersionCount)} definition="Sessions whose survey version is not registered in the dashboard." href={m.unknownVersionCount ? link({ versions: ["unknown"] }) : undefined} tone={m.unknownVersionCount ? "warn" : undefined} />
          </section>

          {m.unknownVersionCount ? (
            <Notice tone="warn">
              {m.unknownVersionCount} session(s) cannot be assessed because their survey version is not registered. They are counted in totals but not in completeness figures.
            </Notice>
          ) : null}

          <div className="grid-2">
            <ChartCard
              id="completion-by-version"
              title="Completion by survey version"
              description="Mean required completion of finished sessions, per version."
              table={{ columns: ["Version", "Sessions", "Mean required completion (%)", "Completion rate (%)"], rows: a.versions.map((v) => [v.version ?? "unknown", v.sessions, v.meanCompletion === null ? null : Math.round(v.meanCompletion * 100), v.completionRate === null ? null : Math.round(v.completionRate * 100)]) }}
            >
              <BarList
                ariaLabel="Completion by version"
                max={1}
                items={a.versions.map((v) => ({
                  key: v.hash,
                  text: v.version ? `Version ${v.version}` : "Unknown version",
                  label: v.version ? `v${v.version}` : "Unknown version",
                  sub: `${int(v.sessions)} session${v.sessions === 1 ? "" : "s"} · ${pct(v.completionRate)} complete`,
                  value: v.meanCompletion ?? 0,
                  display: v.known ? pct(v.meanCompletion) : "unavailable",
                  href: link({ versions: [v.hash] }),
                }))}
              />
            </ChartCard>
            <ChartCard
              id="completion-by-section-c"
              title="Completion by section"
              description="Click a section to open the sessions with missing required answers in it."
              table={{ columns: ["Section", "Completion (%)", "Applied to", "Reached", "With gaps"], rows: a.sections.map((s) => [s.title, s.completion === null ? null : Math.round(s.completion * 100), s.sessionsApplicable, s.sessionsReached, s.sessionsWithMissing]) }}
            >
              <BarList
                ariaLabel="Completion by section"
                max={1}
                items={a.sections.map((s) => ({ key: s.key, text: s.title, label: s.title, sub: `applied to ${int(s.sessionsApplicable)} · ${int(s.sessionsWithMissing)} with gaps`, value: s.completion ?? 0, display: pct(s.completion), href: link({ sectionIncomplete: s.key }) }))}
              />
            </ChartCard>
          </div>

          <div className="grid-2">
            <ChartCard
              id="missing-required-c"
              title="Commonly missed required questions"
              description="Click a question to open the sessions missing it."
              table={{ columns: ["Question ID", "Question", "Sessions missing it"], rows: a.topMissing.map((q) => [q.key, q.text, q.count]) }}
            >
              <BarList ariaLabel="Commonly missed questions" empty="No missing required answers." items={a.topMissing.map((q) => ({ key: q.key, text: `${q.key}: ${q.text}`, label: <><code>{q.key}</code> {q.text}</>, sub: q.sectionTitle, value: q.count, display: int(q.count), href: link({ missingKey: q.key }) }))} />
            </ChartCard>
            <ChartCard
              id="drop-off-c"
              title="Abandonment and drop-off"
              description="Where unfinished sessions stopped, by section."
              table={{ columns: ["Section", "Unfinished sessions stopping here"], rows: a.dropOffSections.map((d) => [d.title, d.count]) }}
            >
              <BarList ariaLabel="Drop-off by section" empty="No unfinished sessions." items={a.dropOffSections.map((d) => ({ key: d.key, text: d.title, label: d.title, value: d.count, display: int(d.count), href: link({ dropOffSection: d.key }), color: "var(--st-abandoned)" }))} />
            </ChartCard>
          </div>

          <ChartCard
            id="completeness-trend"
            title="Completeness over time"
            description={`Mean required completion of sessions finished, by ${a.granularity} they started.`}
            table={{ columns: [a.granularity === "week" ? "Week starting" : "Day", "Mean required completion (%)", "Sessions started"], rows: a.series.map((p) => [p.bucket, p.meanCompletion === null ? null : Math.round(p.meanCompletion * 100), p.started]) }}
          >
            <LineChart ariaLabel="Mean required completion over time" yMax={1} format={(v) => `${Math.round(v * 100)}%`} series={[{ key: "c", label: "Mean required completion", color: "var(--viz-accent)" }]} points={a.series.map((p) => ({ x: p.bucket, label: shortDay(p.bucket), values: { c: p.meanCompletion } }))} />
          </ChartCard>

          <p className="hint">
            Completion by individual question, with answer distributions, is on the <Link to={`/questions${filterQuery(params)}`}>Questions</Link> page.
          </p>
        </div>
      ) : null}
      <Dialog open={defs} onClose={() => setDefs(false)} title="How completeness is calculated" wide>
        <HelpContent />
      </Dialog>
    </div>
  );
}
