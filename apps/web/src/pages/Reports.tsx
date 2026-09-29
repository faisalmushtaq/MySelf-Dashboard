import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where, Timestamp } from "firebase/firestore";
import { EXPORT_KIND_LABELS, type ExportKind } from "@myself-dashboard/core";
import { firebase, STUDY } from "../lib/firebase";
import { downloadExport } from "../lib/download";
import { bytes, dateTime, int, relative } from "../lib/format";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { useFilters } from "../app/filters";
import { useSessionState } from "../lib/hooks";
import { PageHeader } from "../components/Metric";
import { ExportDialog } from "../components/ExportDialog";
import { Icon } from "../components/Icon";
import { EmptyState, Notice } from "../components/States";
import { periodLabel } from "./Overview";

interface JobRow {
  id: string;
  status: string;
  progress: number;
  fileName: string;
  kind: ExportKind;
  format: string;
  rowCount: number | null;
  bytes: number | null;
  createdAt: string | null;
  expiresAt: string | null;
  error: string | null;
  requestedByEmail: string | null;
  sessionCount: number | null;
}

const ts = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);

/**
 * Reports and exports: start an export (preview, confirm, generated on the
 * server) and see recent ones with their expiry. Files are downloadable only by
 * their creator (and administrators) until they are deleted.
 */
export default function Reports() {
  const { me, can } = useAuth();
  const announce = useAnnounce();
  const { filters, sort } = useFilters();
  const [selected] = useSessionState<string[]>("sessions.selected", []);
  const [dialog, setDialog] = useState<ExportKind | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!me?.uid) return;
    const col = collection(firebase().db, `studies/${STUDY}/exportJobs`);
    const q = all && can("audit.readAll") ? query(col, orderBy("createdAt", "desc"), limit(50)) : query(col, where("requestedBy", "==", me.uid), orderBy("createdAt", "desc"), limit(25));
    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setJobs(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              status: String(x["status"]),
              progress: Number(x["progress"] ?? 0),
              fileName: String(x["fileName"] ?? ""),
              kind: x["kind"] as ExportKind,
              format: String(x["format"] ?? ""),
              rowCount: typeof x["rowCount"] === "number" ? x["rowCount"] : null,
              bytes: typeof x["bytes"] === "number" ? x["bytes"] : null,
              createdAt: ts(x["createdAt"]),
              expiresAt: ts(x["expiresAt"]),
              error: typeof x["error"] === "string" ? x["error"] : null,
              requestedByEmail: typeof x["requestedByEmail"] === "string" ? x["requestedByEmail"] : null,
              sessionCount: typeof (x["preview"] as { sessionCount?: number } | undefined)?.sessionCount === "number" ? (x["preview"] as { sessionCount: number }).sessionCount : null,
            };
          }),
        );
      },
      () => setError("Recent exports could not be loaded."),
    );
  }, [me?.uid, all, can]);

  const cards: { kind: ExportKind; title: string; text: string; needs: "export.sessions" | "export.aggregate" }[] = [
    { kind: "sessions", title: "Session data", text: "One row per session (or per answer), for the current filters, a selection, or everything. CSV, Excel, or JSON for administrators.", needs: "export.sessions" },
    { kind: "completeness_summary", title: "Completeness summary", text: "Headline figures, completion by section and version, most-missed questions, drop-off and the daily series. CSV, Excel or a formatted PDF.", needs: "export.aggregate" },
    { kind: "question_summary", title: "Question-level summary", text: "Every question in one survey version: eligible, shown, answered, skipped, invalid, rates and distributions.", needs: "export.aggregate" },
    {
      kind: "school_report",
      title: "School report",
      text: "One school, or one of its year groups, against the other schools combined and published benchmarks. Written to be shared with the school: averages only, small groups withheld.",
      needs: "export.aggregate",
    },
  ];

  return (
    <div className="page">
      <PageHeader title="Reports and exports" description={<>Exports use the current filters ({periodLabel(filters)}) unless you choose all sessions or a selection.</>} />
      <Notice>
        Exports are generated on the server with your permissions, kept privately for {me?.policy?.exportRetentionHours ?? 24} hours, and every export and download is
        recorded in the audit log. Names, dates of birth and study-code components are never exported. A single session's formatted PDF report is available from
        that session.
      </Notice>
      <div className="report-cards">
        {cards.map((c) => (
          <section key={c.kind} className="card report-card">
            <h2>{c.title}</h2>
            <p>{c.text}</p>
            {can(c.needs) ? (
              <button type="button" className="btn btn-primary" onClick={() => setDialog(c.kind)}>
                <Icon name="download" size={16} /> Export {c.title.toLowerCase()}
              </button>
            ) : (
              <p className="hint">
                <Icon name="lock" size={14} /> Not available for your role.
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Recent exports</h2>
          {can("audit.readAll") ? (
            <label className="check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Everyone's exports
            </label>
          ) : null}
        </div>
        {error ? <Notice tone="warn">{error}</Notice> : null}
        {jobs && jobs.length === 0 ? <EmptyState icon="reports" title="No exports yet" /> : null}
        {jobs && jobs.length > 0 ? (
          <div className="table-scroll">
            <table className="data">
              <caption className="sr-only">Recent exports</caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Type</th>
                  {all ? <th scope="col">By</th> : null}
                  <th scope="col" className="num">Sessions</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expires</th>
                  <th scope="col"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td><code className="filename">{j.fileName}</code></td>
                    <td>{EXPORT_KIND_LABELS[j.kind] ?? j.kind} · {j.format.toUpperCase()}</td>
                    {all ? <td>{j.requestedByEmail}</td> : null}
                    <td className="num">{int(j.sessionCount)}</td>
                    <td>{dateTime(j.createdAt)}</td>
                    <td>
                      {j.status === "running" ? (
                        <span className="badge"><span className="spinner small" aria-hidden="true" /> Generating {Math.round(j.progress * 100)}%</span>
                      ) : j.status === "ready" ? (
                        <span className="badge status-complete"><Icon name="check" size={13} /> Ready · {bytes(j.bytes)}</span>
                      ) : j.status === "failed" ? (
                        <span className="badge status-invalid" title={j.error ?? ""}><Icon name="alert" size={13} /> Failed</span>
                      ) : (
                        <span className="badge status-not_started"><Icon name="clock" size={13} /> Expired</span>
                      )}
                    </td>
                    <td>{j.status === "ready" ? relative(j.expiresAt).replace(" ago", "") : "—"}</td>
                    <td>
                      {j.status === "ready" ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() =>
                            void downloadExport(j.id, j.fileName)
                              .then(() => announce("Download started.", "success"))
                              .catch((e) => announce((e as Error).message, "error"))
                          }
                        >
                          <Icon name="download" size={14} /> Download
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <ExportDialog open={dialog !== null} onClose={() => setDialog(null)} initial={{ kind: dialog ?? "completeness_summary", scope: "filtered", filters, sort, sessionIds: selected }} />
    </div>
  );
}
