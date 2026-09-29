import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PARTICIPANT_ATTENTION_LABELS, type ParticipantAttention, type ParticipantView } from "@myself-dashboard/core";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { dateOnly, dateTime, relative } from "../lib/format";
import { Metric, PageHeader } from "../components/Metric";
import { EmptyState, ErrorState, Loading, Notice } from "../components/States";
import { StatusBadge } from "../components/Status";
import { Icon } from "../components/Icon";

const PAGE = 50;

type WaveFilter = "all" | "one" | "several";
type AttentionFilter = "any" | "attention" | ParticipantAttention;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * Participants: sittings joined into people by the survey's participant code — the
 * secret code up to r7.3.0, an ID from name and date of birth from r8.0.0 — exactly
 * as the survey's own export joins them — and what that linkage could not
 * settle. Read-only: codes are corrected and twins separated in the survey's
 * researcher tool, where the names are.
 *
 * Codes never go into the address bar or browser storage; the search box is
 * plain component state.
 */
export default function Participants() {
  const [fresh, setFresh] = useState(0);
  const { data, error, loading, reload } = useLoad(() => api.getParticipants({ fresh: fresh > 0 }), [fresh]);
  const [search, setSearch] = useState("");
  const [waves, setWaves] = useState<WaveFilter>("all");
  const [attention, setAttention] = useState<AttentionFilter>("any");
  const [site, setSite] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const sites = useMemo(() => [...new Set((data?.participants ?? []).flatMap((p) => p.sites))].sort(), [data]);
  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (data?.participants ?? []).filter(
      (p) =>
        (!q || p.code.toUpperCase().includes(q) || p.sittings.some((s) => s.sessionId.toUpperCase().includes(q))) &&
        (waves === "all" || (waves === "one" ? p.waves === 1 : p.waves > 1)) &&
        (attention === "any" || (attention === "attention" ? p.attention.length > 0 : p.attention.includes(attention))) &&
        (!site || p.sites.includes(site)),
    );
  }, [data, search, waves, attention, site]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE, current * PAGE);
  const filter = (f: () => void) => {
    f();
    setPage(1);
  };

  const t = data?.totals;
  return (
    <div className="page">
      <PageHeader
        title="Participants"
        description="Sittings joined into participants by the survey's participant code (the secret code up to survey version 7.3.0; from 8.0.0 an ID made from name and date of birth), exactly as the survey's own export joins them. Codes are corrected and twins separated in the survey's researcher tool (Linkage tab); the result shows here on refresh."
        actions={
          <button type="button" className="btn" onClick={() => setFresh((n) => n + 1)} disabled={loading}>
            <Icon name="refresh" size={16} /> {loading && fresh ? "Re-linking…" : "Re-link now"}
          </button>
        }
      />
      {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : null}
      {!data && !error ? <Loading label="Linking sittings into participants" /> : null}
      {data && t ? (
        <>
          {!data.codesShown ? (
            <Notice>
              Your role sees labels (P0001, P0002…) instead of participant codes. They are numbered in order of each participant&apos;s first sitting and mean
              nothing outside this page.
            </Notice>
          ) : null}
          <section className="metric-grid" aria-label="Linkage in numbers">
            <Metric label="Participants" value={t.participants.toLocaleString("en-GB")} sub={`as of ${relative(data.computedAt)}`} definition="Distinct participant codes among the sittings the survey could link." />
            <Metric label="Sittings linked" value={t.linkedSittings.toLocaleString("en-GB")} sub={t.byWave.map((w) => `${w.participants} with ${plural(w.waves, "wave")}`).join(" · ")} definition="Sittings joined to a participant code. Each participant's sittings are numbered as waves in the order they began." />
            <Metric label="Followed up" value={t.multiWave.toLocaleString("en-GB")} sub={t.participants ? `${Math.round((t.multiWave / t.participants) * 100)}% of participants have 2+ waves` : undefined} definition="Participants with more than one wave." />
            <Metric
              label="Held back"
              value={t.heldBack.toLocaleString("en-GB")}
              tone={t.heldBack ? "warn" : undefined}
              sub="not linked to anyone"
              definition="Sittings the survey could not link to a participant (an incomplete secret code, or from 8.0.0 a missing name or date of birth; a quarantined log; an unreadable version). They are kept but not counted as anyone's — guessing would join one child's answers to another's."
            />
          </section>

          {data.sharedCodes.length ? (
            <div className="notice notice-warn" role="note">
              <Icon name="alert" size={18} />
              <div>
                <strong>
                  {data.sharedCodes.length === 1 ? "One code is" : `${data.sharedCodes.length} codes are`} shared by more than one child — almost certainly twins.
                </strong>{" "}
                Until they are separated, their answers count as one person&apos;s. Separate them in the survey&apos;s researcher tool (Linkage tab), where the names are.
                <ul className="tight">
                  {data.sharedCodes.map((c) => (
                    <li key={c.code}>
                      <code>{c.code}</code> — {plural(c.sessionIds.length, "sitting")}:{" "}
                      {c.sessionIds.map((id, i) => (
                        <Fragment key={id}>
                          {i ? ", " : ""}
                          <Link to={`/sessions/${id}`}>{id.slice(-8)}</Link>
                        </Fragment>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {t.sameDay ? (
            <div className="notice" role="note">
              <Icon name="info" size={18} />
              <div>
                {plural(t.sameDay, "participant has", "participants have")} two sittings less than a day apart — a restart after a problem, or a duplicate.{" "}
                <button type="button" className="btn-link" onClick={() => filter(() => setAttention("same_day"))}>
                  Show them
                </button>
              </div>
            </div>
          ) : null}

          <div className="card filter-row" role="search">
            <label className="inline-select">
              Find
              <input type="search" value={search} onChange={(e) => filter(() => setSearch(e.target.value))} placeholder={data.codesShown ? "Participant code or session ID" : "Label or session ID"} autoComplete="off" spellCheck={false} />
            </label>
            <label className="inline-select">
              Waves
              <select value={waves} onChange={(e) => filter(() => setWaves(e.target.value as WaveFilter))}>
                <option value="all">Any</option>
                <option value="one">One wave</option>
                <option value="several">Two or more</option>
              </select>
            </label>
            <label className="inline-select">
              Attention
              <select value={attention} onChange={(e) => filter(() => setAttention(e.target.value as AttentionFilter))}>
                <option value="any">Everyone</option>
                <option value="attention">Needs attention</option>
                {(Object.keys(PARTICIPANT_ATTENTION_LABELS) as ParticipantAttention[]).map((a) => (
                  <option key={a} value={a}>
                    {PARTICIPANT_ATTENTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            {sites.length > 1 ? (
              <label className="inline-select">
                Site
                <select value={site} onChange={(e) => filter(() => setSite(e.target.value))}>
                  <option value="">All sites</option>
                  {sites.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="muted small" aria-live="polite">
              {plural(shown.length, "participant")}
            </span>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon="people" title={t.participants ? "No participant matches" : "No linked sittings yet"}>
              {t.participants ? "Clear the search or filters to see everyone." : "Participants appear here once a sitting can be linked: its secret code, or from 8.0.0 its name and date of birth, has been answered."}
            </EmptyState>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Participants and their sittings">
              <table className="data participants">
                <caption className="sr-only">Participants and their sittings</caption>
                <thead>
                  <tr>
                    <th scope="col">{data.codesShown ? "Participant code" : "Participant"}</th>
                    <th scope="col">Waves</th>
                    <th scope="col">Sittings</th>
                    <th scope="col">Sites</th>
                    <th scope="col">First sitting</th>
                    <th scope="col">Latest sitting</th>
                    <th scope="col">Attention</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <ParticipantRow key={p.code} p={p} open={open === p.code} onToggle={() => setOpen(open === p.code ? null : p.code)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 ? (
            <nav className="pagination" aria-label="Pages">
              <button type="button" className="btn btn-small" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                <Icon name="chevronLeft" size={14} /> Previous
              </button>
              <span>
                Page <strong>{current}</strong> of {pages}
              </span>
              <button type="button" className="btn btn-small" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                Next <Icon name="chevronRight" size={14} />
              </button>
            </nav>
          ) : null}

          {data.heldBack.length ? (
            <details className="card">
              <summary>
                <strong>Held-back sittings ({data.heldBack.length})</strong> <span className="muted small">— kept, but not linked to anyone</span>
              </summary>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Sittings not linked to a participant">
                <table className="data">
                  <caption className="sr-only">Sittings not linked to a participant</caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Started</th>
                      <th scope="col">Site</th>
                      <th scope="col">Status</th>
                      <th scope="col">Why it is held back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.heldBack.map((h) => (
                      <tr key={h.sessionId}>
                        <td>
                          <Link to={`/sessions/${h.sessionId}`}>
                            <code>{h.sessionId}</code>
                          </Link>
                        </td>
                        <td>{dateTime(h.startedAt)}</td>
                        <td>{h.site ?? "—"}</td>
                        <td>{h.status ? <StatusBadge status={h.status} compact /> : "—"}</td>
                        <td className="small">{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ParticipantRow({ p, open, onToggle }: { p: ParticipantView; open: boolean; onToggle: () => void }) {
  const detailId = `participant-${p.code}`;
  return (
    <>
      <tr className={p.attention.includes("shared_code") ? "row-warn" : undefined}>
        <th scope="row">
          <button type="button" className="disclosure" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            <code>{p.code}</code>
          </button>
        </th>
        <td className="num">{p.waves}</td>
        <td>
          <span className="wave-strip" aria-label={p.sittings.map((s) => `wave ${s.wave}${s.finished ? " finished" : " not finished"}`).join(", ")}>
            {p.sittings.map((s) => (
              <span key={s.sessionId} className={`wave-dot ${s.finished ? "done" : ""}`} title={`Wave ${s.wave} · ${dateOnly(s.startedAt)}${s.finished ? " · finished" : " · not finished"}`}>
                {s.wave}
              </span>
            ))}
          </span>
        </td>
        <td>{p.sites.join(", ") || "—"}</td>
        <td>{dateOnly(p.firstSeen)}</td>
        <td>{dateOnly(p.lastSeen)}</td>
        <td>
          {p.attention.length ? (
            <span className="tags">
              {p.attention.map((a) => (
                <span key={a} className={`tag ${a === "shared_code" ? "tag-warn" : "tag-quiet"}`}>
                  {PARTICIPANT_ATTENTION_LABELS[a]}
                </span>
              ))}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="subrow">
          <td colSpan={7}>
            <table className="data compact">
              <caption className="sr-only">Sittings of {p.code}</caption>
              <thead>
                <tr>
                  <th scope="col">Wave</th>
                  <th scope="col">Started</th>
                  <th scope="col">Since previous</th>
                  <th scope="col">Version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Answered by</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.sittings.map((s) => (
                  <tr key={s.sessionId}>
                    <td className="num">{s.wave}</td>
                    <td>{dateTime(s.startedAt)}</td>
                    <td>{s.daysSincePrevious === null ? "—" : s.daysSincePrevious === 0 ? "same day" : plural(s.daysSincePrevious, "day")}</td>
                    <td>{s.releaseVersion ? `v${s.releaseVersion}` : "—"}</td>
                    <td>{s.status ? <StatusBadge status={s.status} compact /> : s.finished ? "Finished" : "Not finished"}</td>
                    <td>{s.informant ? s.informant[0]!.toUpperCase() + s.informant.slice(1) : "Participant"}</td>
                    <td>
                      <Link className="btn btn-small btn-quiet" to={`/sessions/${s.sessionId}`} aria-label={`Open session ${s.sessionId}`}>
                        Open <Icon name="chevronRight" size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}
