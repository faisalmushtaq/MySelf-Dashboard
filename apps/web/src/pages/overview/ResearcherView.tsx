import type { ResearcherViewResponse } from "@myself-dashboard/core";
import { api } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { int } from "../../lib/format";
import { useFilters } from "../../app/filters";
import { Metric } from "../../components/Metric";
import { ErrorState, Skeleton } from "../../components/States";

/**
 * The survey researcher view's Overview, beside the dashboard's own.
 *
 * Same labels, same formatting (one decimal place, as the researcher view shows them)
 * and the same code: the server computes these with the researcher view's counting
 * rules, vendored from the survey, over the sittings in these filters. A researcher
 * holding the two tools side by side should see the same numbers; where they do not,
 * the two are holding different sittings, and the note says which way that can go.
 */

const pct1 = (n: number, d: number): string => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const rate1 = (r: number): string => `${(r * 100).toFixed(1)}%`;
const min1 = (v: number | null): string => (v === null ? "—" : v.toFixed(1));
const plural = (n: number, noun: string): string => `${int(n)} ${noun}${n === 1 ? "" : "s"}`;

export function ResearcherView() {
  const { filters } = useFilters();
  const key = JSON.stringify(filters);
  const { data, error, loading, reload } = useLoad<ResearcherViewResponse>(() => api.getResearcherView({ filters }), [key]);
  const f = data?.figures;
  const judged = f ? `of ${plural(f.finishedOrAbandoned, "finished or abandoned sitting")}` : "";

  return (
    <section className={`card ${loading && data ? "dimmed" : ""}`} aria-labelledby="researcher-view-title" aria-busy={loading}>
      <div className="card-head">
        <div>
          <h3 id="researcher-view-title">As the survey&apos;s researcher view counts them</h3>
          <p className="card-desc">
            Computed here by the researcher view&apos;s own code, over the sittings in these filters, so the two can be checked against each other. With the
            default filters these are its numbers with test sittings left out; with &ldquo;Production and test&rdquo;, with &ldquo;Include test sittings&rdquo;
            ticked. The researcher view counts what was last pulled into that browser, plus any files imported there by hand, so it can lag behind this.
          </p>
        </div>
      </div>
      {error && !data ? <ErrorState title="The researcher view's figures could not be calculated" message={error.message} onRetry={reload} /> : null}
      {!data && !error ? <Skeleton lines={3} /> : null}
      {f && data ? (
        <div className="metric-grid">
          <Metric
            label="Sittings"
            value={int(f.sittings)}
            sub={f.notLinked === 0 ? "all linked to a participant" : `${int(f.notLinked)} not linked to a participant`}
            definition={`Every sitting in these filters, whatever its state — including any that gave no name or date of birth, which cannot be filed under a participant. ${
              data.quarantined + data.unreadable > 0
                ? `${plural(data.quarantined + data.unreadable, "quarantined or unreadable sitting")} left out, as the researcher view leaves them out.`
                : "Quarantined and unreadable sittings are left out, as the researcher view leaves them out."
            }`}
          />
          <Metric
            label="Participants"
            value={int(f.participants)}
            sub={`from ${plural(f.linked, "linked sitting")}`}
            definition="Distinct participants among the sittings linked to one, by the survey's own linkage (name and date of birth, with the study's corrections and twin assignments)."
          />
          <Metric
            label="Followed up"
            value={int(f.followedUp)}
            sub={f.participants === 0 ? "no data yet" : `${rate1(f.followedUp / f.participants)} of participants · up to wave ${f.maxWave}`}
            definition="Participants with more than one sitting in these filters."
          />
          <Metric
            label="Reached the end"
            value={pct1(f.reachedEnd, f.finishedOrAbandoned)}
            sub={`${int(f.reachedEnd)} ${judged}`}
            definition="Sittings that reached the finish screen (Complete + Incomplete), out of those that have finished or been abandoned. In progress and not started are in neither count."
          />
          <Metric
            label="All required answered"
            value={pct1(f.allRequiredAnswered, f.finishedOrAbandoned)}
            sub={`${int(f.allRequiredAnswered)} ${judged}`}
            definition="Sittings that reached the end with every required question that applied answered or declined — the dashboard's Complete — out of those that have finished or been abandoned."
          />
          <Metric
            label="Median length"
            value={`${min1(f.durationMinutes.median)} min`}
            sub={
              f.durationMinutes.n === 0
                ? "no sitting has reached the end"
                : `${plural(f.durationMinutes.n, "sitting")} timed on the device · range ${min1(f.durationMinutes.min)}–${min1(f.durationMinutes.max)}`
            }
            definition="Median device-timed length of the linked sittings that reached the end, complete or not, resumed or not. Not the dashboard's Median completion time, which takes only complete sittings that were never interrupted."
          />
          <Metric
            label="Skipped"
            value={rate1(f.skipRate)}
            sub={`of ${int(f.answered + f.skipped)} questions answered, skipped or declined`}
            definition="Questions skipped or declined, out of all questions answered, skipped or declined, in the linked sittings."
          />
          <Metric
            label="Answered very fast"
            value={rate1(f.tooFastRate)}
            sub={`of ${plural(f.answered, "answer")} given`}
            definition="Answers the survey flagged as given faster than the question could be read, out of all answers given, in the linked sittings."
          />
        </div>
      ) : null}
    </section>
  );
}
