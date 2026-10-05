import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, startAfter, Timestamp, where, type QueryConstraint, type QueryDocumentSnapshot } from "firebase/firestore";
import { firebase, STUDY } from "../lib/firebase";
import { dateTime } from "../lib/format";
import { useAuth } from "../app/auth";
import { PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Loading } from "../components/States";

const ACTIONS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.denied": "Access denied",
  "session.viewed": "Viewed a session",
  "review.updated": "Changed a review",
  "note.added": "Added a note",
  "export.created": "Created an export",
  "export.failed": "Export failed",
  "export.downloaded": "Downloaded an export",
  "export.download_denied": "Download refused",
  "chart_data.downloaded": "Downloaded chart data",
  "figure.exported": "Exported a figure",
  "participants.viewed": "Viewed participants",
  "scoring.changed": "Changed a scoring scheme",
  "groups.changed": "Changed schools and year groups",
  "role.changed": "Changed a role",
  "access_policy.changed": "Changed the access list",
  "policy.changed": "Changed study settings",
  "summaries.rebuilt": "Rebuilt summaries",
  "release.registered": "Registered a survey version",
  "release.refused": "Refused a survey version from Studio",
  "survey.provenance_exported": "Exported the survey version history",
};

interface Row {
  id: string;
  at: string | null;
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  target: { type: string; id: string } | null;
  detail: Record<string, unknown> | null;
  outcome: string;
}

/**
 * The audit log. Administrators see everyone's activity; everyone else sees their
 * own. Read straight from Firestore — the security rules enforce exactly that
 * split, and nobody can write or change an entry.
 */
export default function Audit() {
  const { me, can } = useAuth();
  const everyone = can("audit.readAll");
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (after: QueryDocumentSnapshot | null) => {
    if (!me?.uid) return;
    setBusy(true);
    try {
      const constraints: QueryConstraint[] = [];
      if (!everyone) constraints.push(where("actorUid", "==", me.uid));
      if (action) constraints.push(where("action", "==", action));
      constraints.push(orderBy("at", "desc"));
      if (after) constraints.push(startAfter(after));
      constraints.push(limit(50));
      const snap = await getDocs(query(collection(firebase().db, `studies/${STUDY}/auditLog`), ...constraints));
      const page = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          at: x["at"] instanceof Timestamp ? (x["at"] as Timestamp).toDate().toISOString() : null,
          action: String(x["action"]),
          actorEmail: (x["actorEmail"] as string) ?? null,
          actorRole: (x["actorRole"] as string) ?? null,
          target: (x["target"] as Row["target"]) ?? null,
          detail: (x["detail"] as Row["detail"]) ?? null,
          outcome: String(x["outcome"] ?? "success"),
        };
      });
      setRows((prev) => (after ? [...(prev ?? []), ...page] : page));
      setCursor(snap.docs[snap.docs.length - 1] ?? null);
      setMore(snap.docs.length === 50);
      setError(null);
    } catch {
      setError("The audit log could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setRows(null);
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, everyone, me?.uid]);

  const summary = (r: Row) => {
    const d = r.detail ?? {};
    if (r.action === "review.updated") return `${String(d["change"] ?? "")}`;
    if (r.action.startsWith("export")) return [d["kind"], d["format"], d["sessions"] !== undefined ? `${d["sessions"]} sessions` : null, d["fileName"], d["reason"], d["refusal"]].filter(Boolean).join(" · ");
    if (r.action === "role.changed") return `${d["email"]}: ${d["before"] ?? "none"} → ${d["after"] ?? "none"}`;
    if (r.action === "auth.denied") return String(d["reason"] ?? "");
    return "";
  };

  return (
    <div className="page">
      <PageHeader title={everyone ? "Audit activity" : "My activity"} description={everyone ? "Every sign-in, session viewed, review change, export, download and administrative change. Entries cannot be edited or deleted." : "Your own recorded activity. Administrators can see everyone's."} />
      <div className="filter-row card">
        <label className="inline-select">
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <ErrorState message={error} onRetry={() => void load(null)} /> : null}
      {!rows && !error ? <Loading /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="audit" title="No activity recorded" /> : null}
      {rows && rows.length > 0 ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Audit log">
          <table className="data">
            <caption className="sr-only">Audit log</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                {everyone ? <th scope="col">Who</th> : null}
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.at)}</td>
                  {everyone ? <td>{r.actorEmail ?? "—"}{r.actorRole ? <span className="muted"> · {r.actorRole}</span> : null}</td> : null}
                  <td>{ACTIONS[r.action] ?? r.action}</td>
                  <td>{r.target ? <code>{r.target.type}: {r.target.id.length > 20 ? `${r.target.id.slice(0, 20)}…` : r.target.id}</code> : "—"}</td>
                  <td className="small">{summary(r) || "—"}</td>
                  <td>{r.outcome === "success" ? "OK" : r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {more ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void load(cursor)}>
          Load older entries
        </button>
      ) : null}
    </div>
  );
}
