import { Fragment, useState } from "react";
import { myStoryLabel, type LivePeriod, type LiveVersionView, type SurveyVersionView } from "@myself-dashboard/core";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/Metric";
import { EmptyState, ErrorState, Loading, Notice } from "../../components/States";
import { api, explain } from "../../lib/api";
import { saveBlob } from "../../lib/figureFiles";
import { dateOnly, int } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import "./survey.css";

/** Where researchers edit and publish versions: MySelf Studio, in the survey's researcher view. */
export const STUDIO_URL: string = import.meta.env.VITE_STUDIO_URL ?? "https://faisalmushtaq.github.io/MySelf/researcher/#/surveys";

const HOW: Record<LivePeriod["how"], string> = {
  set_up: "already live when Studio was set up",
  published: "published",
  made_live_again: "made live again",
  pointer: "the live version",
};

/**
 * Survey → Versions (docs/11): every version of the survey as MySelf Studio
 * published it — who wrote and published it, what changed, whether it ends
 * with MyStory, when it was the one the iPads ran — and how many sittings the
 * dashboard has recorded under it. Read-only: versions are edited and
 * published in Studio.
 */
export default function Versions() {
  const history = useLoad(() => api.listSurveyVersions({}), []);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (history.error) return <ErrorState message={history.error.message} onRetry={history.reload} />;
  if (!history.data) return <Loading label="Loading the survey's versions" />;
  const { studioSetUp, live, versions, unknownSittings } = history.data;

  const exportAs = async (kind: "csv" | "json") => {
    try {
      const out = await api.exportSurveyProvenance({});
      saveBlob(new Blob([kind === "csv" ? out.csv : out.json], { type: kind === "csv" ? "text/csv" : "application/json" }), `survey_versions.${kind}`);
    } catch (e) {
      setMessage(explain(e).message);
    }
  };
  const download = async (v: SurveyVersionView) => {
    try {
      const { manifestJson } = await api.getSurveyManifest({ hash: v.hash });
      saveBlob(new Blob([manifestJson], { type: "application/json" }), `${v.releaseKey}.manifest.json`);
    } catch (e) {
      setMessage(explain(e).message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Survey versions"
        description="Every version of the survey: who wrote and published it, what changed, when it was on the iPads, and how many sittings it collected. A version is never changed once published; a change makes a new one."
        actions={
          <>
            <a className="btn btn-primary" href={STUDIO_URL} target="_blank" rel="noopener noreferrer">
              Edit in Studio <Icon name="external" size={16} />
            </a>
            <button type="button" className="btn" onClick={() => void exportAs("csv")}>
              <Icon name="download" size={16} /> Version history (CSV)
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void exportAs("json")}>
              JSON
            </button>
          </>
        }
      />
      <Notice>
        Versions are edited, previewed and published in <strong>MySelf Studio</strong>, in the survey's researcher view. This page is a read-only record of
        what Studio published; nothing here changes what the iPads run.
      </Notice>
      {message ? <Notice tone="warn">{message}</Notice> : null}

      <section className="card" aria-labelledby="live-h">
        <h2 id="live-h">On the iPads now</h2>
        {live.length > 0 ? (
          live.map((l) => <LiveLine key={l.surveyId} live={l} many={live.length > 1} />)
        ) : (
          <p>
            <strong>The version built into the app.</strong>{" "}
            {studioSetUp
              ? "Studio has no live version yet, so each iPad runs the version bundled in the survey app."
              : "Studio has not been set up from the live survey yet, so each iPad runs the version bundled in the survey app. Studio's history appears here once an administrator sets it up."}
          </p>
        )}
        {unknownSittings > 0 ? (
          <p className="hint">
            {int(unknownSittings)} sitting{unknownSittings === 1 ? " was" : "s were"} recorded under a version neither Studio nor the dashboard's registry knows. They are
            counted as an unregistered version until it is registered.
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="versions-h">
        <h2 id="versions-h">History</h2>
        {versions.length === 0 ? (
          <EmptyState title="No versions yet">Versions appear here once Studio publishes them, or once they are registered.</EmptyState>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Survey versions">
            <table className="data versions-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Published</th>
                  <th>Made in</th>
                  <th>What changed</th>
                  <th>MyStory</th>
                  <th className="num">Sittings</th>
                  <th>On the iPads</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const key = `${v.surveyId ?? ""} ${v.hash}`;
                  const isOpen = open === key;
                  return (
                    <Fragment key={key}>
                      <tr className={v.live ? "row-current" : undefined}>
                        <td>
                          <strong>v{v.version}</strong> {v.live ? <span className="tag tag-good">live</span> : null}
                          {v.bump ? (
                            <div className="hint">
                              {v.bump.toUpperCase()}
                              {v.basedOn ? ` on v${v.basedOn}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {v.publishedAt ? dateOnly(v.publishedAt) : "—"}
                          {v.publishedBy && v.publishedBy !== "repository" ? <div className="hint">by {v.publishedBy}</div> : null}
                          {v.authors.length ? <div className="hint">written by {v.authors.join(", ")}</div> : null}
                        </td>
                        <td>
                          {v.source === "studio" ? "Studio" : "The repository"}
                          {!v.inStudio ? <div className="hint">not in Studio</div> : null}
                        </td>
                        <td className="what-changed">
                          {v.releaseNote ? <div>{v.releaseNote}</div> : <span className="hint">—</span>}
                          {v.changes.length > 0 ? (
                            <button type="button" className="btn-link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                              {v.changes.length} change{v.changes.length === 1 ? "" : "s"}
                            </button>
                          ) : null}
                        </td>
                        <td>{v.myStory ? <code>{myStoryLabel(v.myStory)}</code> : <span className="hint">—</span>}</td>
                        <td className="num">
                          {int(v.sittings)}
                          {v.sittings > 0 ? (
                            <div className="hint">
                              {int(v.complete)} complete · {int(v.partial)} partial
                              <br />
                              {dateOnly(v.firstSitting)} – {dateOnly(v.lastSitting)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {v.livePeriods.length ? (
                            <ul className="periods">
                              {v.livePeriods.map((p, i) => (
                                <li key={i}>
                                  {dateOnly(p.from)} – {p.to ? dateOnly(p.to) : "now"}
                                  <div className="hint">
                                    {HOW[p.how]}
                                    {p.reason ? `: ${p.reason}` : ""}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="hint">—</span>
                          )}
                        </td>
                        <td className="row-actions">
                          <button type="button" className="btn btn-small btn-quiet" onClick={() => void download(v)} title="Download this version's frozen manifest">
                            <Icon name="download" size={14} /> Manifest
                          </button>
                        </td>
                      </tr>
                      {v.problem || (!v.registered && v.sittings > 0) ? (
                        <tr className="row-problem">
                          <td colSpan={8}>
                            <span className="tag tag-warn">
                              <Icon name="alert" size={12} /> Not read
                            </span>{" "}
                            {v.problem ??
                              `${int(v.sittings)} sitting${v.sittings === 1 ? "" : "s"} under this version have not been read yet. An administrator can read them now with Settings → Data maintenance → Re-summarise sessions with unknown versions.`}
                          </td>
                        </tr>
                      ) : null}
                      {isOpen ? (
                        <tr className="row-detail">
                          <td colSpan={8}>
                            <ul className="changes">
                              {v.changes.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Live periods come from Studio's audit trail. A version that was live before Studio was set up was live before the trail began, so only its time
          since then is shown.
        </p>
      </section>
    </div>
  );
}

function LiveLine({ live, many }: { live: LiveVersionView; many: boolean }) {
  return (
    <p>
      <strong>v{live.version}</strong>
      {many ? ` of ${live.title}` : ""}
      {live.since ? `, live since ${dateOnly(live.since)}` : ""}. New sittings use it from each iPad's next start screen; a sitting already under way
      finishes on the version it started with.
    </p>
  );
}
