import { Fragment, useState } from "react";
import { myStoryLabel, participantLink, studioLink, type LivePeriod, type LiveVersionView, type SurveyVersionView } from "@myself-dashboard/core";
import { useAnnounce } from "../../app/announcer";
import { useAuth } from "../../app/auth";
import { useStudyData } from "../../app/data";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/Metric";
import { EmptyState, ErrorState, Loading, Notice } from "../../components/States";
import { api, explain } from "../../lib/api";
import { saveBlob } from "../../lib/figureFiles";
import { dateOnly, int } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import "./survey.css";

/** Where researchers edit and publish versions: MySelf Studio's survey list, in the survey's researcher view. */
export const STUDIO_URL: string = import.meta.env.VITE_STUDIO_URL ?? "https://faisalmushtaq.github.io/MySelf/researcher/#/surveys";
/** The participant app's address, which every participant link starts from (survey docs/16 §11.2). */
export const PARTICIPANT_URL: string = import.meta.env.VITE_PARTICIPANT_URL ?? "https://faisalmushtaq.github.io/MySelf/";

const HOW: Record<LivePeriod["how"], string> = {
  set_up: "already live when Studio was set up",
  published: "published",
  made_live_again: "made live again",
  pointer: "the live version",
};

interface SurveyGroup {
  surveyId: string | null;
  title: string;
  live: LiveVersionView | null;
  versions: SurveyVersionView[];
}

/**
 * Survey → Versions (docs/11, docs/12 §12.8): every version of every survey in
 * the study on screen, as MySelf Studio published it — who wrote and published
 * it, what changed, whether it ends with MyStory, when it was the one the iPads
 * ran — and how many sittings the dashboard has recorded under it; and each live
 * survey's participant link. Read-only: versions are edited and published in
 * Studio.
 */
export default function Versions() {
  const { me } = useAuth();
  const { study, surveys } = useStudyData();
  const history = useLoad(() => api.listSurveyVersions({}), []);
  const [message, setMessage] = useState<string | null>(null);

  if (history.error) return <ErrorState message={history.error.message} onRetry={history.reload} />;
  if (!history.data) return <Loading label="Loading the survey's versions" />;
  const { studioSetUp, live, versions, unknownSittings } = history.data;

  // One group per survey: the study's surveys in their order, then any only a version names.
  const groups: SurveyGroup[] = [];
  const groupOf = (surveyId: string | null): SurveyGroup => {
    let g = groups.find((x) => x.surveyId === surveyId);
    if (!g) {
      const known = surveys.find((s) => s.surveyId === surveyId);
      const l = live.find((x) => x.surveyId === surveyId) ?? null;
      g = { surveyId, title: known?.title ?? l?.title ?? surveyId ?? "Versions whose survey is not known", live: l, versions: [] };
      groups.push(g);
    }
    return g;
  };
  for (const s of surveys) groupOf(s.surveyId);
  for (const l of live) groupOf(l.surveyId);
  for (const v of versions) groupOf(v.survey).versions.push(v);
  const shown = groups.filter((g) => g.live || g.versions.length > 0);
  const studyId = me?.study ?? study.study;

  const exportAs = async (kind: "csv" | "json") => {
    try {
      const out = await api.exportSurveyProvenance({});
      saveBlob(new Blob([kind === "csv" ? out.csv : out.json], { type: kind === "csv" ? "text/csv" : "application/json" }), `${studyId}_survey_versions.${kind}`);
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
        description={`Every version of every survey in ${study.title}: who wrote and published it, what changed, when it was on the iPads, and how many sittings it collected. A version is never changed once published; a change makes a new one.`}
        actions={
          <>
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
      {study.status === "closed" ? (
        <Notice tone="warn">
          {study.title} is closed in Studio: it takes no new iPads and no new sittings. Sittings already collected are still read here.
        </Notice>
      ) : null}
      {message ? <Notice tone="warn">{message}</Notice> : null}

      {shown.length === 0 ? (
        <section className="card">
          <EmptyState title="No versions yet">Versions appear here once Studio publishes them, or once they are registered.</EmptyState>
        </section>
      ) : null}
      {shown.map((g, i) => (
        <SurveySection key={g.surveyId ?? "unknown"} group={g} index={i} study={studyId} defaultStudy={me?.defaultStudy ?? studyId} studioSetUp={studioSetUp} download={download} />
      ))}
      {unknownSittings > 0 ? (
        <p className="hint">
          {int(unknownSittings)} sitting{unknownSittings === 1 ? " was" : "s were"} recorded under a version neither Studio nor the dashboard's registry knows. They are
          counted as an unregistered version until it is registered.
        </p>
      ) : null}
      <p className="hint">
        Live periods come from Studio's audit trail. A version that was live before Studio was set up was live before the trail began, so only its time since
        then is shown.
      </p>
    </div>
  );
}

function SurveySection({
  group,
  index,
  study,
  defaultStudy,
  studioSetUp,
  download,
}: {
  group: SurveyGroup;
  index: number;
  study: string;
  defaultStudy: string;
  studioSetUp: boolean;
  download: (v: SurveyVersionView) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const studio = studioLink(STUDIO_URL, group.surveyId ? { study, surveyId: group.surveyId } : null, defaultStudy);
  const headingId = `survey-${index}-h`;
  return (
    <section className="card survey-card" aria-labelledby={headingId}>
      <div className="survey-head">
        <h2 id={headingId}>
          {group.title} {group.surveyId ? <code className="survey-id">{group.surveyId}</code> : null}
        </h2>
        {group.surveyId ? (
          <a className="btn btn-primary btn-small" href={studio.href} target="_blank" rel="noopener noreferrer" aria-label={`Edit in Studio: ${group.title}`}>
            Edit in Studio <Icon name="external" size={14} />
          </a>
        ) : null}
      </div>
      {!studio.routed && group.surveyId ? <p className="hint">Studio opens on its list of surveys: choose {study} in Studio's study switcher there.</p> : null}
      {group.live ? (
        <>
          <LiveLine live={group.live} />
          <ParticipantLink study={study} surveyId={group.live.surveyId} title={group.title} />
        </>
      ) : group.surveyId ? (
        <p>
          <strong>{study === defaultStudy && !studioSetUp ? "The version built into the app." : "No live version."}</strong>{" "}
          {studioSetUp
            ? "Studio has no live version of this survey, so it has no participant link."
            : "Studio has not been set up from the live survey yet, so each iPad runs the version bundled in the survey app. Studio's history appears here once an administrator sets it up."}
        </p>
      ) : null}
      {group.versions.length === 0 ? null : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`Versions of ${group.title}`}>
          <table className="data versions-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Published</th>
                <th>What changed</th>
                <th>MyStory</th>
                <th className="num">Sittings</th>
                <th>On the iPads</th>
              </tr>
            </thead>
            <tbody>
              {group.versions.map((v) => {
                const key = `${v.surveyId ?? ""} ${v.hash}`;
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr className={v.live ? "row-current" : undefined}>
                      <td>
                        <strong>v{v.version}</strong> {v.live ? <span className="tag tag-good">live</span> : null}
                        <div className="hint nowrap">{v.source === "studio" ? "Made in Studio" : "From the repository"}</div>
                        {v.chosenBump ? (
                          <div className="hint nowrap" title={v.requiredBump && v.requiredBump !== v.chosenBump ? `The changes needed ${v.requiredBump.toUpperCase()}` : undefined}>
                            {v.chosenBump.toUpperCase()}
                            {v.basedOn ? ` on v${v.basedOn}` : ""}
                          </div>
                        ) : null}
                        {v.restoredFrom ? <div className="hint nowrap">restored from v{v.restoredFrom}</div> : null}
                        {!v.inStudio ? <div className="hint nowrap">not in Studio</div> : null}
                        <button type="button" className="btn-link nowrap" onClick={() => void download(v)} title={`Download the frozen manifest of v${v.version}`}>
                          <Icon name="download" size={14} /> Manifest
                        </button>
                      </td>
                      <td className="published">
                        {v.publishedAt ? dateOnly(v.publishedAt) : "—"}
                        {v.publishedBy && v.publishedBy !== "repository" ? (
                          <div className="hint">
                            by <Email address={v.publishedBy} />
                          </div>
                        ) : null}
                      </td>
                      <td className="what-changed">
                        {v.releaseNote ? <div>{v.releaseNote}</div> : <span className="hint">—</span>}
                        {v.authors.length ? (
                          <div className="hint">
                            Written by{" "}
                            {v.authors.map((a, i) => (
                              <Fragment key={a}>
                                {i > 0 ? ", " : ""}
                                <Email address={a} />
                              </Fragment>
                            ))}
                          </div>
                        ) : null}
                        {v.changes.length > 0 ? (
                          <button type="button" className="btn-link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                            {v.changes.length} change{v.changes.length === 1 ? "" : "s"}
                          </button>
                        ) : null}
                      </td>
                      <td className="mystory">
                        {v.myStory ? (
                          <>
                            <code title={myStoryLabel(v.myStory)}>{v.myStory.protocol}</code>
                            {v.myStory.protocolVersion ? <div className="hint">version {v.myStory.protocolVersion}</div> : null}
                          </>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td className="num">
                        {int(v.sittings)}
                        {v.sittings > 0 ? (
                          <>
                            <div className="hint nowrap">
                              {int(v.complete)} complete · {int(v.partial)} partial
                            </div>
                            <div className="hint">
                              <span className="nowrap">{dateOnly(v.firstSitting)}</span> – <span className="nowrap">{dateOnly(v.lastSitting)}</span>
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="live-periods">
                        {v.livePeriods.length ? (
                          <ul className="periods">
                            {v.livePeriods.map((p, i) => (
                              <li key={i}>
                                <span className="nowrap">{dateOnly(p.from)}</span> – <span className="nowrap">{p.to ? dateOnly(p.to) : "now"}</span>
                                <div className="hint">
                                  {HOW[p.how]}
                                  {p.by && p.how === "made_live_again" ? (
                                    <>
                                      {" "}
                                      by <Email address={p.by} />
                                    </>
                                  ) : null}
                                  {p.reason ? `: ${p.reason}` : ""}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                    </tr>
                    {v.problem || (!v.registered && v.sittings > 0) ? (
                      <tr className="row-problem">
                        <td colSpan={6}>
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
                        <td colSpan={6}>
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
    </section>
  );
}

/**
 * The survey's participant link, exactly as the Studio builds it (survey docs/16
 * §11.2, the vendored `participantLink`): both parameters, always, and nothing
 * about anybody. Opened on an iPad, it sets the iPad to this survey.
 */
function ParticipantLink({ study, surveyId, title }: { study: string; surveyId: string; title: string }) {
  const announce = useAnnounce();
  let link: string;
  try {
    link = participantLink(PARTICIPANT_URL, { study, surveyId });
  } catch {
    return null;
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      announce(`Copied the participant link for ${title}.`, "success");
    } catch {
      announce("The link could not be copied: select it and copy it by hand.", "error");
    }
  };
  return (
    <div className="participant-link">
      <span className="participant-link-label">Participant link</span>
      <code className="participant-link-url">{link}</code>
      <button type="button" className="btn btn-small" onClick={() => void copy()} aria-label={`Copy the participant link for ${title}`}>
        <Icon name="copy" size={14} /> Copy
      </button>
      <p className="hint">Open it on an iPad to set the iPad to this survey; it stays there offline. The link names the survey, never a participant.</p>
    </div>
  );
}

/** An address that may wrap after its "@", never in the middle of a word. */
function Email({ address }: { address: string }) {
  const at = address.indexOf("@");
  if (at < 0) return <>{address}</>;
  return (
    <>
      {address.slice(0, at + 1)}
      <wbr />
      {address.slice(at + 1)}
    </>
  );
}

function LiveLine({ live }: { live: LiveVersionView }) {
  return (
    <p>
      <strong>v{live.version}</strong>
      {live.since ? `, live since ${dateOnly(live.since)}` : ", live"}. New sittings use it from each iPad's next start screen; a sitting already under way finishes on
      the version it started with.
    </p>
  );
}
