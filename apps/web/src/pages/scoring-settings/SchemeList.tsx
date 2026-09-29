import { formatNumber, SCHEME_STATUS_LABELS, type ScoringSettingsView } from "@myself-dashboard/core";
import { Icon } from "../../components/Icon";

/** Scoring settings (../ScoringSettings.tsx): the table of every instrument's scheme. */

export function SchemeList({ data, selected, onSelect }: { data: ScoringSettingsView; selected: string | null; onSelect: (k: string) => void }) {
  return (
    <section className="card" aria-labelledby="schemes-h">
      <h2 id="schemes-h">Scoring schemes</h2>
      <p className="hint">
        The dashboard ships a scheme for each instrument the survey administers, following the published method where there is one. Each is marked verified once an
        administrator has checked it against the instrument's licensed scoring documents.
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Scoring schemes">
        <table className="data compact">
          <caption className="sr-only">Scoring schemes</caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Method</th>
              <th scope="col">Version</th>
              <th scope="col">Verified</th>
              <th scope="col" className="num">
                Sittings
              </th>
              <th scope="col">Checks</th>
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.schemes.map((s) => {
              const errors = s.checks.flatMap((c) => c.issues).filter((i) => i.level === "error").length;
              const warnings = s.checks.flatMap((c) => c.issues).filter((i) => i.level === "warning").length;
              return (
                <tr key={s.scheme.key} className={selected === s.scheme.key ? "row-selected" : undefined}>
                  <th scope="row">
                    {s.scheme.abbreviation ?? s.scheme.name}
                    <div className="muted small">{s.scheme.abbreviation ? s.scheme.name : s.scheme.key}</div>
                  </th>
                  <td>{SCHEME_STATUS_LABELS[s.scheme.status]}</td>
                  <td>
                    v{s.scheme.version} <span className="muted small">{s.source === "study" ? (s.differsFromDefault ? "study's own" : "saved") : "dashboard default"}</span>
                  </td>
                  <td>{s.scheme.verified ? <span className="tag tag-good">{s.scheme.verified.by}</span> : <span className="tag tag-warn">Not yet</span>}</td>
                  <td className="num">{formatNumber(s.sittings)}</td>
                  <td>{errors ? <span className="tag tag-warn">{errors} error{errors === 1 ? "" : "s"}</span> : warnings ? <span className="tag tag-quiet">{warnings} note{warnings === 1 ? "" : "s"}</span> : <span className="muted">OK</span>}</td>
                  <td>
                    <button type="button" className="btn btn-small btn-quiet" onClick={() => onSelect(s.scheme.key)} aria-label={`Open the ${s.scheme.name} scheme`}>
                      {data.canEdit ? "Edit" : "View"} <Icon name="chevronRight" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
