import { Link } from "react-router-dom";
import {
  DATE_BASIS_LABELS,
  DATE_PRESET_LABELS,
  describeFilters,
  DISPLAY_STATUSES,
  STATUS_HELP,
  STATUS_LABELS,
  WARNING_LABELS,
  type AnalyticsResponse,
  type DisplayStatus,
} from "@myself-dashboard/core";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { dateTime, duration, int, pct, relative, shortDay } from "../lib/format";
import { useFilters, sessionsLink } from "../app/filters";
import { FilterBar } from "../app/FilterControls";
import { useStudyData } from "../app/data";
import { Metric, PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/States";
import { STATUS_ICON } from "../components/Status";
import { Icon } from "../components/Icon";
import { ChartCard } from "../charts/ChartCard";
import { LineChart } from "../charts/LineChart";
import { BarList } from "../charts/BarList";
import { Columns } from "../charts/Columns";

export function useAnalytics() {
  const { filters } = useFilters();
  const key = JSON.stringify(filters);
  return useLoad<AnalyticsResponse>(() => api.getAnalytics({ filters }), [key]);
}

export const STATUS_COLOR: Record<DisplayStatus, string> = {
  complete: "var(--st-complete)",
  incomplete: "var(--st-incomplete)",
  abandoned: "var(--st-abandoned)",
  in_progress: "var(--st-in_progress)",
  not_started: "var(--st-not_started)",
  needs_review: "var(--st-needs_review)",
  invalid: "var(--st-invalid)",
  test: "var(--st-test)",
};

export function periodLabel(f: ReturnType<typeof useFilters>["filters"]): string {
  const range = f.datePreset === "custom" ? `${f.from ?? "…"} to ${f.to ?? "…"}` : DATE_PRESET_LABELS[f.datePreset];
  return `${range}, by ${DATE_BASIS_LABELS[f.dateBasis].toLowerCase()}`;
}

export default function Overview() {
  const { filters } = useFilters();
  const { data, error, loading, reload } = useAnalytics();
  const { activeRelease } = useStudyData();
  const a = data?.analytics;
  const m = a?.metrics;
  const link = (patch: Parameters<typeof sessionsLink>[1]) => sessionsLink(filters, patch);
  const filtersActive = describeFilters(filters).length > 0;

  return (
    <div className="page">
      <PageHeader title="Overview" description={<>Survey activity and completeness — {periodLabel(filters)}. Production data unless you choose otherwise.</>} />
      <FilterBar />
      {error && !data ? <ErrorState title="The overview could not be calculated" message={error.message} onRetry={reload} /> : null}
      {error && data ? <Notice tone="warn">Showing the last figures that loaded. {error.message}</Notice> : null}
      {!data && !error ? (
        <div className="metric-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="metric" key={i}>
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      ) : null}
      {a && m && m.started === 0 ? (
        filtersActive ? (
          <EmptyState icon="filter" title="No sessions match these filters" action={<Link to="/overview">Reset the filters</Link>}>
            Nothing in {periodLabel(filters)} matches. Widen the date range or remove a filter.
          </EmptyState>
        ) : (
          <EmptyState icon="sessions" title="No sessions yet">
            The survey has not filed any sittings to the study, or they have not yet been summarised. Sittings appear here within a minute of reaching Firestore.
          </EmptyState>
        )
      ) : null}
      {a && m && m.started > 0 ? (
        <div className={loading ? "dimmed" : ""} aria-busy={loading}>
          {m.unknownVersionCount > 0 ? (
            <Notice tone="warn">
              {m.unknownVersionCount} session{m.unknownVersionCount === 1 ? " uses" : "s use"} a survey version that is not in the registry, so their completeness is
              unavailable. <Link to={link({ versions: ["unknown"] })}>Show them</Link>. An administrator can register the version in Settings.
            </Notice>
          ) : null}
          <section className="metric-grid" aria-label="Key figures">
            <Metric
              hero
              label="Completion rate"
              value={pct(m.completionRate)}
              sub={`${int(m.complete)} of ${int(m.completionRateDenominator)} finished or abandoned sessions`}
              definition="Complete ÷ (Complete + Incomplete + Abandoned). In-progress, not-started and invalid sessions are excluded: they have not had, or cannot be judged to have had, the chance to finish."
            />
            <Metric label="Sessions started" value={int(m.started)} href={link({})} definition="Every session in the current filters, whatever its status." />
            <Metric label="Completed" value={int(m.complete)} href={link({ statuses: ["complete"] })} definition={STATUS_HELP.complete} />
            <Metric label="Incomplete" value={int(m.incomplete)} href={link({ statuses: ["incomplete"] })} definition={STATUS_HELP.incomplete} />
            <Metric label="Abandoned" value={int(m.abandoned)} href={link({ statuses: ["abandoned"] })} definition={STATUS_HELP.abandoned} />
            <Metric label="Requiring review" value={int(m.needsReview)} href={link({ statuses: ["needs_review"] })} definition={STATUS_HELP.needs_review} tone={m.needsReview > 0 ? "warn" : undefined} />
            <Metric
              label="Median completion time"
              value={m.medianDurationMs === null ? "—" : duration(m.medianDurationMs)}
              sub={m.medianDurationMs === null ? `Not shown: ${m.durationN} usable session${m.durationN === 1 ? "" : "s"} (needs 5)` : `n = ${int(m.durationN)}`}
              definition="Median of the device-measured duration of complete sessions that were never interrupted and resumed (a resumed session's timer only covers its last stretch)."
            />
            <Metric label="New in period" value={int(m.newInPeriod)} definition="Sessions the server first received inside the date range (server clock)." />
            <Metric
              label="Most recent response"
              value={m.latestResponseAt ? relative(m.latestResponseAt) : "—"}
              sub={m.latestResponseAt ? dateTime(m.latestResponseAt) : undefined}
              definition="The latest answer recorded on any device in these filters (device clock). The server's latest receipt is in the tooltip of 'Data updated' in the header."
            />
            <Metric label="Data last refreshed" value={relative(data!.freshness.lastSummaryAt)} sub={`Figures calculated ${relative(a.computedAt)}`} definition="When the dashboard last summarised a session from the survey database, and when these figures were computed." />
            <Metric
              label="Active published version"
              value={activeRelease ? `v${activeRelease.version}` : "—"}
              sub={activeRelease ? `Published ${dateTime(activeRelease.publishedAt)}` : "No versions registered"}
              definition="The release the survey is serving: set by an administrator, otherwise the newest registered release."
            />
          </section>

          <div className="grid-2">
            <ChartCard
              id="sessions-over-time"
              title="Sessions started and completed"
              description={`Per ${a.granularity}. Started by start date; completed by completion date.`}
              table={{ columns: [a.granularity === "week" ? "Week starting" : "Day", "Started", "Completed"], rows: a.series.map((p) => [p.bucket, p.started, p.completed]) }}
            >
              <LineChart
                ariaLabel={`Sessions started and completed per ${a.granularity}. Total started ${m.started}, completed ${m.complete}.`}
                series={[
                  { key: "started", label: "Started", color: "var(--viz-muted)" },
                  { key: "completed", label: "Completed", color: "var(--viz-accent)" },
                ]}
                points={a.series.map((p) => ({ x: p.bucket, label: shortDay(p.bucket), values: { started: p.started, completed: p.completed } }))}
              />
            </ChartCard>
            <ChartCard
              id="completion-rate-over-time"
              title="Completion rate over time"
              description={`Of sessions started each ${a.granularity} that have finished or been abandoned, the share that are complete.`}
              table={{ columns: [a.granularity === "week" ? "Week starting" : "Day", "Completion rate (%)", "Sessions judged"], rows: a.series.map((p) => [p.bucket, p.completionRate === null ? null : Math.round(p.completionRate * 100), p.terminalOrAbandoned]) }}
            >
              <LineChart
                ariaLabel="Completion rate over time, as a percentage."
                yMax={1}
                format={(v) => `${Math.round(v * 100)}%`}
                series={[{ key: "rate", label: "Completion rate", color: "var(--viz-accent)" }]}
                points={a.series.map((p) => ({ x: p.bucket, label: shortDay(p.bucket), values: { rate: p.completionRate } }))}
              />
            </ChartCard>
          </div>

          <div className="grid-2">
            <ChartCard
              id="status-breakdown"
              title="Session status"
              description="Lifecycle and markers. A session can carry a marker and a lifecycle, so marker rows overlap the others."
              table={{ columns: ["Status", "Sessions"], rows: a.statusBreakdown.map((s) => [STATUS_LABELS[s.status], s.count]) }}
            >
              <BarList
                ariaLabel="Sessions by status"
                items={DISPLAY_STATUSES.map((s) => {
                  const count = a.statusBreakdown.find((x) => x.status === s)?.count ?? 0;
                  return {
                    key: s,
                    text: STATUS_LABELS[s],
                    label: STATUS_LABELS[s],
                    icon: (
                      <span className={`status-dot status-${s}`} aria-hidden="true">
                        <Icon name={STATUS_ICON[s]} size={12} />
                      </span>
                    ),
                    value: count,
                    display: int(count),
                    color: STATUS_COLOR[s],
                    href: link({ statuses: [s] }),
                  };
                })}
                max={m.started}
              />
            </ChartCard>
            <ChartCard
              id="section-completion"
              title="Completion by survey section"
              description="Required answers given ÷ required answers that applied, across sessions where the section applied."
              table={{ columns: ["Section", "Completion (%)", "Sessions where it applied", "Sessions with gaps"], rows: a.sections.map((s) => [s.title, s.completion === null ? null : Math.round(s.completion * 100), s.sessionsApplicable, s.sessionsWithMissing]) }}
            >
              <BarList
                ariaLabel="Completion by section"
                max={1}
                items={a.sections.map((s) => ({
                  key: s.key,
                  text: s.title,
                  label: s.title,
                  sub: `${int(s.sessionsWithMissing)} with gaps`,
                  value: s.completion ?? 0,
                  display: pct(s.completion),
                  href: link({ sectionIncomplete: s.key }),
                }))}
              />
            </ChartCard>
          </div>

          <div className="grid-2">
            <ChartCard
              id="most-missed"
              title="Most commonly unanswered required questions"
              description="Required questions that applied but were skipped, left, not reached or invalid."
              table={{ columns: ["Question ID", "Question", "Sessions missing it"], rows: a.topMissing.map((q) => [q.key, q.text, q.count]) }}
            >
              <BarList
                ariaLabel="Most commonly unanswered required questions"
                empty="No missing required answers in these filters."
                items={a.topMissing.map((q) => ({ key: q.key, text: `${q.key}: ${q.text}`, label: <><code>{q.key}</code> {q.text}</>, value: q.count, display: int(q.count), href: link({ missingKey: q.key }) }))}
              />
            </ChartCard>
            <ChartCard
              id="drop-off"
              title="Where unfinished sessions stopped"
              description="The last question shown in sessions that did not reach the end."
              table={{ columns: ["Question ID", "Question", "Unfinished sessions"], rows: a.dropOff.map((q) => [q.key, q.text, q.count]) }}
            >
              <BarList
                ariaLabel="Drop-off points"
                empty="No unfinished sessions in these filters."
                items={a.dropOff.map((q) => ({ key: q.key, text: `${q.key}: ${q.text}`, label: <><code>{q.key}</code> {q.text}</>, value: q.count, display: int(q.count), href: link({ dropOffKey: q.key }), color: "var(--st-abandoned)" }))}
              />
            </ChartCard>
          </div>

          <div className="grid-2">
            <ChartCard
              id="version-activity"
              title="Activity by survey version"
              description="Sessions collected under each version, with its completion rate."
              table={{ columns: ["Version", "Sessions", "Completion rate (%)", "First session", "Last session"], rows: a.versions.map((v) => [v.version ?? "unknown", v.sessions, v.completionRate === null ? null : Math.round(v.completionRate * 100), v.firstStartedAt, v.lastStartedAt]) }}
            >
              <BarList
                ariaLabel="Sessions by survey version"
                items={a.versions.map((v) => ({
                  key: v.hash,
                  text: v.version ? `Version ${v.version}` : "Unknown version",
                  label: v.version ? `v${v.version}` : "Unknown version",
                  sub: `${pct(v.completionRate)} complete · ${v.firstStartedAt ? shortDay(v.firstStartedAt.slice(0, 10)) : "—"} – ${v.lastStartedAt ? shortDay(v.lastStartedAt.slice(0, 10)) : "—"}`,
                  value: v.sessions,
                  display: int(v.sessions),
                  href: link({ versions: [v.hash] }),
                }))}
              />
            </ChartCard>
            <ChartCard
              id="duration"
              title="Completion time"
              description="Complete, never-interrupted sessions, by device-measured duration."
              table={{ columns: ["Duration", "Sessions"], rows: a.durationHistogram.map((b) => [b.label, b.count]) }}
              footnote={m.durationN < 5 ? "Too few sessions to describe reliably." : `n = ${m.durationN}. Median ${duration(m.medianDurationMs)}.`}
            >
              <Columns ariaLabel="Distribution of completion times" bins={a.durationHistogram.map((b) => ({ label: b.label.replace(" min", ""), title: b.label, value: b.count }))} />
            </ChartCard>
          </div>

          {a.signals.length ? (
            <ChartCard
              id="signals"
              title="Data-quality signals"
              description="Automatic signals in these sessions. Signals on unreviewed sessions put them in the review queue."
              table={{ columns: ["Signal", "Sessions"], rows: a.signals.map((s) => [WARNING_LABELS[s.code] ?? s.code, s.count]) }}
            >
              <BarList
                ariaLabel="Data-quality signals"
                items={a.signals.map((s) => ({ key: s.code, text: WARNING_LABELS[s.code] ?? s.code, label: WARNING_LABELS[s.code] ?? s.code, value: s.count, display: int(s.count), href: link({ warning: s.code }), color: "var(--viz-muted)" }))}
              />
            </ChartCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
