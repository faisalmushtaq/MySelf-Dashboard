import { Fragment, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { activePeriods, type VersionRecord } from "@myself-dashboard/core";
import { useAuth } from "../../app/auth";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/Metric";
import { EmptyState, ErrorState, Loading, Notice } from "../../components/States";
import { api, explain } from "../../lib/api";
import { saveBlob } from "../../lib/figureFiles";
import { dateOnly, dateTime, int } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import "./survey.css";

/**
 * Survey → Versions (docs/11): every version of the survey, where it came
 * from, what changed, who published it and why, when it was the one devices
 * used, and how many sittings it collected — with the drafts in progress.
 *
 * Owners can make an earlier version active again (the rollback) from here.
 */
export default function Versions() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const versions = useLoad(() => api.listSurveyVersions({}), []);
  const drafts = useLoad(() => api.listSurveyDrafts({}), [], { enabled: can("survey.edit") });
  const [open, setOpen] = useState<string | null>(null);
  const [rollback, setRollback] = useState<VersionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (versions.error) return <ErrorState message={versions.error.message} onRetry={versions.reload} />;
  if (!versions.data) return <Loading label="Loading the survey's versions" />;
  const { active, activations, canPublish } = versions.data;
  const list = [...versions.data.versions].reverse();
  const periods = activePeriods(activations);
  const newestEditable = list.find((v) => v.version.localeCompare("7.2.0", undefined, { numeric: true }) >= 0);

  const exportAs = async (kind: "csv" | "json") => {
    try {
      const out = await api.exportSurveyProvenance({});
      saveBlob(new Blob([kind === "csv" ? out.csv : out.json], { type: kind === "csv" ? "text/csv" : "application/json" }), `survey_versions.${kind}`);
    } catch (e) {
      setMessage(explain(e).message);
    }
  };
  const download = async (v: VersionRecord) => {
    try {
      const { manifestJson } = await api.getSurveyManifest({ hash: v.hash });
      saveBlob(new Blob([manifestJson], { type: "application/json" }), `${v.key}.manifest.json`);
    } catch (e) {
      setMessage(explain(e).message);
    }
  };
  const startDraft = (v: VersionRecord) => navigate(`/survey/drafts/new?from=${encodeURIComponent(v.hash)}`);

  return (
    <div className="page">
      <PageHeader
        title="Survey versions"
        description="Every version of the survey: what changed, who published it and why, when devices used it, and what it collected. A version is never edited once published; changes make a new one."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void exportAs("csv")}>
              <Icon name="download" size={16} /> Version history (CSV)
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void exportAs("json")}>
              JSON
            </button>
            {can("survey.edit") && newestEditable ? (
              <button type="button" className="btn btn-primary" onClick={() => startDraft(newestEditable)}>
                <Icon name="plus" size={16} /> New draft from v{newestEditable.version}
              </button>
            ) : null}
          </>
        }
      />
      {message ? <Notice tone="warn">{message}</Notice> : null}

      <section className="card" aria-labelledby="active-h">
        <h2 id="active-h">On devices now</h2>
        {active ? (
          <p>
            <strong>v{active.version}</strong> — made active {dateTime(active.activatedAt)}. New sittings on every iPad use it; a sitting already under way
            finishes on the version it started with.
          </p>
        ) : (
          <p>
            No version has been published from the dashboard yet, so each iPad runs the version bundled in the survey app (
            {list[0] ? `v${list[0].version} at most` : "none registered"}).
          </p>
        )}
      </section>

      {can("survey.edit") ? (
        <section className="card" aria-labelledby="drafts-h">
          <h2 id="drafts-h">Drafts</h2>
          {drafts.error ? <Notice tone="warn">{drafts.error.message}</Notice> : null}
          {!drafts.data ? (
            <Loading label="Loading drafts" />
          ) : drafts.data.drafts.length === 0 ? (
            <p className="hint">No drafts. Start one from a version below.</p>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Drafts">
              <table className="data">
                <thead>
                  <tr>
                    <th>Draft</th>
                    <th>Starts from</th>
                    <th className="num">Changes</th>
                    <th>Last saved</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.data.drafts.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/survey/drafts/${d.id}`}>{d.name}</Link>
                      </td>
                      <td>v{d.baseVersion}</td>
                      <td className="num">{int(d.edits)}</td>
                      <td>
                        {dateTime(d.updatedAt)} {d.updatedBy ? <span className="hint">by {d.updatedBy}</span> : null}
                      </td>
                      <td>{d.status === "published" ? `Published as v${d.publishedVersion}` : "In progress"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="versions-h">
        <h2 id="versions-h">History</h2>
        {list.length === 0 ? (
          <EmptyState title="No versions registered">Versions appear here once registered or published.</EmptyState>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Survey versions">
            <table className="data">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Published</th>
                  <th>Made</th>
                  <th>What changed</th>
                  <th>MyStory</th>
                  <th className="num">Sittings</th>
                  <th>On devices</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const isOpen = open === v.hash;
                  const when = periods.get(v.hash) ?? [];
                  const editable = v.version.localeCompare("7.2.0", undefined, { numeric: true }) >= 0;
                  return (
                    <Fragment key={v.hash}>
                      <tr className={active?.hash === v.hash ? "row-current" : undefined}>
                        <td>
                          <strong>v{v.version}</strong>
                          {active?.hash === v.hash ? <span className="tag tag-good">active</span> : null}
                          {v.bump ? (
                            <div className="hint">
                              {v.bump.toUpperCase()}
                              {v.baseVersion ? ` on v${v.baseVersion}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {dateOnly(v.publishedAt)}
                          <div className="hint">{v.publishedBy ?? "—"}</div>
                        </td>
                        <td>{v.source === "editor" ? "In the editor" : "In the repository"}</td>
                        <td>
                          {v.changes.length > 0 ? (
                            <button type="button" className="btn-link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.hash)}>
                              {v.changes.length} change{v.changes.length === 1 ? "" : "s"}
                            </button>
                          ) : (
                            <span className="hint">see the release notes in the repository</span>
                          )}
                          {v.notes ? <div className="hint">Why: {v.notes}</div> : null}
                        </td>
                        <td>{v.mystory ?? "—"}</td>
                        <td className="num">
                          {int(v.sittings)}
                          {v.firstSitting ? (
                            <div className="hint">
                              {dateOnly(v.firstSitting)} – {dateOnly(v.lastSitting)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {when.length ? when.map((p) => `${dateOnly(p.from)} – ${p.to ? dateOnly(p.to) : "now"}`).join("; ") : <span className="hint">—</span>}
                        </td>
                        <td className="row-actions">
                          <div className="stack-actions">
                            <button
                              type="button"
                              className="btn btn-small btn-quiet"
                              onClick={() => void download(v)}
                              title="Download this version's frozen manifest"
                            >
                              <Icon name="download" size={14} /> Manifest
                            </button>
                            {can("survey.edit") && editable ? (
                              <button type="button" className="btn btn-small btn-quiet" onClick={() => startDraft(v)}>
                                Start a draft
                              </button>
                            ) : null}
                            {canPublish && active?.hash !== v.hash && editable ? (
                              <button type="button" className="btn btn-small" onClick={() => setRollback(v)}>
                                Make active
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
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
          Versions before v7.2.0 cannot start a draft: today's publish checks refuse their SWEMWBS scoring (D-49), which later versions corrected.
        </p>
      </section>

      <RollbackDialog
        version={rollback}
        busy={busy}
        onClose={() => setRollback(null)}
        onConfirm={async (reason) => {
          if (!rollback) return;
          setBusy(true);
          try {
            await api.activateSurveyVersion({ hash: rollback.hash, reason });
            setMessage(`v${rollback.version} is now the version new sittings use.`);
            setRollback(null);
            await versions.reload();
          } catch (e) {
            setMessage(explain(e).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function RollbackDialog({
  version,
  busy,
  onClose,
  onConfirm,
}: {
  version: VersionRecord | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={version !== null}
      onClose={onClose}
      title={version ? `Make v${version.version} active again` : ""}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            Make active
          </button>
        </>
      }
    >
      <p>
        New sittings on every iPad will use v{version?.version} from their next start. Sittings already under way finish on the version they started with.
        Nothing is deleted: you can make any version active again later.
      </p>
      <label className="field">
        Why (kept with the version history)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
      </label>
    </Dialog>
  );
}
