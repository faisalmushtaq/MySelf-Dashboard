import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { DEFAULT_FILTERS, describeFilters, filtersToParams, sanitiseFilters, sanitiseSort, sortToParams, type FilterState } from "@myself-dashboard/core";
import { firebase, STUDY } from "../lib/firebase";
import { dateTime } from "../lib/format";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { useStudyData } from "../app/data";
import { PageHeader } from "../components/Metric";
import { Icon } from "../components/Icon";
import { EmptyState, Notice } from "../components/States";

interface ViewDoc {
  id: string;
  name: string;
  description?: string;
  ownerUid: string;
  ownerEmail?: string;
  shared: boolean;
  state: { path?: string; filters?: unknown; sort?: unknown; columns?: string[]; density?: string; pageSize?: number };
  updatedAt: string | null;
}

export function viewUrl(state: ViewDoc["state"]): string {
  const p = filtersToParams(sanitiseFilters(state.filters));
  sortToParams(sanitiseSort(state.sort), p);
  if (state.columns?.length) p.set("cols", state.columns.join(","));
  if (state.density === "compact") p.set("dens", "compact");
  if (state.pageSize) p.set("size", String(state.pageSize));
  const path = state.path && /^\/(sessions|overview|completeness|questions)$/.test(state.path) ? state.path : "/sessions";
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

/** Ready-made views, built from the filter model (not stored). */
function suggestions(activeHash: string | undefined): { name: string; description: string; filters: FilterState }[] {
  return [
    { name: "Incomplete sessions from the last 30 days", description: "Finished with missing required answers, started in the last 30 days.", filters: { ...DEFAULT_FILTERS, datePreset: "30d", statuses: ["incomplete"] } },
    { name: "Sessions requiring review", description: "Flagged, set to Needs review, or carrying an unreviewed data-quality signal.", filters: { ...DEFAULT_FILTERS, statuses: ["needs_review"] } },
    ...(activeHash ? [{ name: "Current survey version only", description: "Sessions collected under the active release.", filters: { ...DEFAULT_FILTERS, versions: [activeHash] } }] : []),
    { name: "Abandoned sessions", description: "Not finished and not heard from within the abandonment window.", filters: { ...DEFAULT_FILTERS, statuses: ["abandoned"] } },
  ];
}

export default function SavedViews() {
  const { me, can } = useAuth();
  const announce = useAnnounce();
  const { activeRelease, versionLabel } = useStudyData();
  const [mine, setMine] = useState<ViewDoc[] | null>(null);
  const [shared, setShared] = useState<ViewDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.uid) return;
    const col = collection(firebase().db, `studies/${STUDY}/savedViews`);
    const map = (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) =>
      snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, ...(x as Omit<ViewDoc, "id" | "updatedAt">), updatedAt: x["updatedAt"] instanceof Timestamp ? (x["updatedAt"] as Timestamp).toDate().toISOString() : null };
      });
    const a = onSnapshot(query(col, where("ownerUid", "==", me.uid), orderBy("updatedAt", "desc"), limit(100)), (s) => setMine(map(s)), () => setError("Your saved views could not be loaded."));
    const b = onSnapshot(query(col, where("shared", "==", true), orderBy("updatedAt", "desc"), limit(100)), (s) => setShared(map(s)), () => setError("Shared views could not be loaded."));
    return () => {
      a();
      b();
    };
  }, [me?.uid]);

  const rename = async (v: ViewDoc) => {
    const name = window.prompt("New name for this view", v.name)?.trim();
    if (!name) return;
    await updateDoc(doc(firebase().db, `studies/${STUDY}/savedViews/${v.id}`), { name: name.slice(0, 80), updatedAt: serverTimestamp() })
      .then(() => announce("View renamed.", "success"))
      .catch(() => announce("The view could not be renamed.", "error"));
  };
  const toggleShare = async (v: ViewDoc) => {
    await updateDoc(doc(firebase().db, `studies/${STUDY}/savedViews/${v.id}`), { shared: !v.shared, updatedAt: serverTimestamp() })
      .then(() => announce(v.shared ? "View is now private." : "View shared with all dashboard members.", "success"))
      .catch(() => announce("Sharing could not be changed.", "error"));
  };
  const remove = async (v: ViewDoc) => {
    if (!window.confirm(`Delete the view “${v.name}”?`)) return;
    await deleteDoc(doc(firebase().db, `studies/${STUDY}/savedViews/${v.id}`))
      .then(() => announce("View deleted.", "success"))
      .catch(() => announce("The view could not be deleted.", "error"));
  };

  const row = (v: ViewDoc, owned: boolean) => (
    <li key={v.id} className="view-row">
      <div>
        <Link to={viewUrl(v.state)} className="view-name">
          {v.name}
        </Link>
        {v.shared ? <span className="tag tag-quiet">Shared</span> : null}
        {v.description ? <p>{v.description}</p> : null}
        <p className="hint">
          {describeFilters(sanitiseFilters(v.state.filters), { version: versionLabel }).map((c) => c.label).join(" · ") || "No filters"}
          {!owned && v.ownerEmail ? ` — by ${v.ownerEmail}` : ""} · updated {dateTime(v.updatedAt)}
        </p>
      </div>
      {owned ? (
        <div className="button-row">
          <button type="button" className="btn btn-small btn-quiet" onClick={() => void rename(v)}>
            Rename
          </button>
          {can("views.share") || v.shared ? (
            <button type="button" className="btn btn-small btn-quiet" onClick={() => void toggleShare(v)}>
              {v.shared ? "Make private" : "Share"}
            </button>
          ) : null}
          <button type="button" className="btn btn-small btn-quiet" onClick={() => void remove(v)} aria-label={`Delete ${v.name}`}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      ) : can("settings.access") ? (
        <button type="button" className="btn btn-small btn-quiet" onClick={() => void remove(v)}>
          <Icon name="trash" size={14} /> Delete
        </button>
      ) : null}
    </li>
  );

  return (
    <div className="page">
      <PageHeader title="Saved views" description="Reusable combinations of filters, sort order and columns. Save one from the Sessions page." />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <section className="card">
        <h2>Suggested views</h2>
        <ul className="views">
          {suggestions(activeRelease?.hash).map((s) => (
            <li key={s.name} className="view-row">
              <div>
                <Link className="view-name" to={viewUrl({ path: "/sessions", filters: s.filters })}>
                  {s.name}
                </Link>
                <p>{s.description}</p>
              </div>
            </li>
          ))}
          <li className="view-row">
            <div>
              <span className="view-name">Sessions missing a specific required question</span>
              <p>Open a question on the Completeness or Questions page and choose its “missing” count — then save that list as a view.</p>
            </div>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Your views</h2>
        {mine && mine.length === 0 ? <EmptyState icon="views" title="No saved views yet">Use “Save view” on the Sessions page.</EmptyState> : null}
        <ul className="views">{mine?.map((v) => row(v, true))}</ul>
      </section>
      <section className="card">
        <h2>Shared with the team</h2>
        {shared && shared.filter((v) => v.ownerUid !== me?.uid).length === 0 ? <p className="hint">No views have been shared by others.</p> : null}
        <ul className="views">{shared?.filter((v) => v.ownerUid !== me?.uid).map((v) => row(v, false))}</ul>
      </section>
    </div>
  );
}
