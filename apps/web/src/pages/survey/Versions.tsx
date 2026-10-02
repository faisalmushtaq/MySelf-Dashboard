import { useState } from "react";
import type { SurveyVersionView } from "@myself-dashboard/core";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/Metric";
import { EmptyState, ErrorState, Loading, Notice } from "../../components/States";
import { api, explain } from "../../lib/api";
import { saveBlob } from "../../lib/figureFiles";
import { dateOnly, int } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import "./survey.css";

/**
 * Survey → Versions (docs/11): every version of the survey, when it was
 * published, and how many sittings it collected. Read-only.
 */
export default function Versions() {
  const versions = useLoad(() => api.listSurveyVersions({}), []);
  const [message, setMessage] = useState<string | null>(null);

  if (versions.error) return <ErrorState message={versions.error.message} onRetry={versions.reload} />;
  if (!versions.data) return <Loading label="Loading the survey's versions" />;
  const list = [...versions.data.versions].reverse();

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
        description="Every version of the survey: when it was published and what it collected. A version is never edited once published; changes make a new one."
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
      {message ? <Notice tone="warn">{message}</Notice> : null}

      <section className="card" aria-labelledby="versions-h">
        <h2 id="versions-h">History</h2>
        {list.length === 0 ? (
          <EmptyState title="No versions registered">Versions appear here once registered.</EmptyState>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Survey versions">
            <table className="data">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Published</th>
                  <th className="num">Sittings</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.hash}>
                    <td>
                      <strong>v{v.version}</strong>
                    </td>
                    <td>{dateOnly(v.publishedAt)}</td>
                    <td className="num">
                      {int(v.sittings)}
                      {v.firstSitting ? (
                        <div className="hint">
                          {dateOnly(v.firstSitting)} – {dateOnly(v.lastSitting)}
                        </div>
                      ) : null}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-small btn-quiet" onClick={() => void download(v)} title="Download this version's frozen manifest">
                        <Icon name="download" size={14} /> Manifest
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
