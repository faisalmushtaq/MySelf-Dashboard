import { Link } from "react-router-dom";
import { SCHEME_STATUS_HELP, SCHEME_STATUS_LABELS, type ScoresView, type ScoringScheme } from "@myself-dashboard/core";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/States";

/** Scores (../Scores.tsx): the chosen instrument's scheme — method, status, verification and checks. */

export function SchemeCard({ scheme, view }: { scheme: ScoringScheme; view: ScoresView }) {
  const checks = view.checks[scheme.key] ?? [];
  const issues = checks.flatMap((c) => c.issues.map((i) => ({ ...i, version: c.version })));
  return (
    <section className="card scheme-card" aria-labelledby="scheme-title">
      <div className="card-head">
        <div>
          <h2 id="scheme-title">
            {scheme.name} {scheme.abbreviation ? <span className="muted">({scheme.abbreviation})</span> : null}
          </h2>
          <div className="tags">
            <span className={`tag ${scheme.status === "study" ? "tag-quiet" : ""}`} title={SCHEME_STATUS_HELP[scheme.status]}>
              {SCHEME_STATUS_LABELS[scheme.status]}
            </span>
            <span className="tag tag-quiet">
              Scheme {scheme.key} v{scheme.version}
            </span>
            {scheme.verified ? (
              <span className="tag tag-good">
                <Icon name="check" size={12} /> Verified by {scheme.verified.by}, {scheme.verified.at.slice(0, 10)}
              </span>
            ) : (
              <span className="tag tag-warn" title="An administrator marks the scheme verified once it has been checked against the instrument's licensed scoring documents.">
                <Icon name="alert" size={12} /> Not yet verified against the scoring documents
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="scheme-method">{scheme.method}</p>
      {scheme.notes ? <p className="muted small">{scheme.notes}</p> : null}
      <p className="small">
        <Link to="/settings/scoring">How this is scored, its bands and benchmarks, and their versions</Link>
      </p>
      {scheme.status !== "official" ? <p className="muted small">{SCHEME_STATUS_HELP[scheme.status]}</p> : null}
      {issues.length ? (
        <Notice tone="warn">
          <ul className="plain-list">
            {issues.map((i, n) => (
              <li key={n}>
                v{i.version}: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </section>
  );
}
