import {
  ESTIMATE_REASON_LABELS,
  OUTCOME_HELP,
  OUTCOME_LABELS,
  STATUS_HELP,
  STATUS_LABELS,
  DISPLAY_STATUSES,
  OUTCOMES,
} from "@myself-dashboard/core";
import { StatusBadge } from "../components/Status";
import { useAuth } from "../app/auth";

/** Definitions shown in the app — the same text as docs/03-completeness.md. */
export function HelpContent() {
  const { me } = useAuth();
  const p = me?.policy;
  return (
    <div className="help">
      <section>
        <h3>Completeness</h3>
        <p>
          Every session is judged against the survey version the participant actually received. A question counts as <strong>required</strong> when its
          level is {p ? p.requiredLevels.join(" or ") : "hard or soft"} <em>and</em> it applied to this participant.
        </p>
        <p className="formula">Required completion = (required questions answered or declined) ÷ (required questions that applied)</p>
        <p>
          Questions hidden by the survey's own skip logic are not counted. Where it cannot be known whether a question applied — it depends on an answer the
          participant never reached — the result is shown as an estimate (≈), never with false precision. Reasons an estimate is given:
        </p>
        <ul>
          {Object.values(ESTIMATE_REASON_LABELS).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Session status</h3>
        <dl className="defs">
          {DISPLAY_STATUSES.map((s) => (
            <div key={s}>
              <dt>
                <StatusBadge status={s} />
              </dt>
              <dd>
                {STATUS_HELP[s]}
                {s === "abandoned" && p ? ` The window is ${p.abandonAfterHours} hours.` : ""}
              </dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          A session shows its most important marker (Invalid, Test, Needs review) and names its lifecycle beside it. Filtering by a lifecycle (e.g.{" "}
          {STATUS_LABELS.incomplete}) includes sessions that also carry a marker.
        </p>
      </section>
      <section>
        <h3>What happened to each question</h3>
        <dl className="defs">
          {[...OUTCOMES, "not_in_version" as const].map((o) => (
            <div key={o}>
              <dt>{OUTCOME_LABELS[o]}</dt>
              <dd>{OUTCOME_HELP[o]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>Figures</h3>
        <p>
          The Figures page builds publication-ready figures from the current filters: journal column widths, Arial/Helvetica at 6–8 pt, colour-blind-safe
          or greyscale colours, 95% confidence intervals where proportions are compared, a draft figure legend and the source data behind each panel. Figures
          use aggregates only; every downloaded file is recorded in the audit log first.
        </p>
        <h3>Keyboard</h3>
        <dl className="defs keys">
          <div><dt><kbd>/</kbd></dt><dd>Focus the session search</dd></div>
          <div><dt><kbd>j</kbd> / <kbd>k</kbd> or <kbd>→</kbd> / <kbd>←</kbd></dt><dd>Next / previous session (session view)</dd></div>
          <div><dt><kbd>m</kbd></dt><dd>Jump to the next missing required answer</dd></div>
          <div><dt><kbd>f</kbd></dt><dd>Next flagged session</dd></div>
          <div><dt><kbd>Esc</kbd> / <kbd>b</kbd></dt><dd>Back to the results</dd></div>
          <div><dt><kbd>↑</kbd> / <kbd>↓</kbd>, <kbd>Enter</kbd></dt><dd>Move through the session table and open a row</dd></div>
          <div><dt>Charts: <kbd>←</kbd> / <kbd>→</kbd></dt><dd>Move the crosshair when a chart has focus</dd></div>
        </dl>
      </section>
      <section>
        <h3>Privacy</h3>
        <ul>
          <li>Names, dates of birth and study-code components are never shown or exported here, for any role.</li>
          <li>Researcher notes and flags are kept apart from the participant's answers and never change them.</li>
          <li>Every session viewed, review change, export and download is recorded in the audit log.</li>
          <li>Exports are generated on the server, downloadable only by the person who made them, and deleted after {p?.exportRetentionHours ?? 24} hours.</li>
          <li>Study time zone: {p?.timeZone ?? "Europe/London"}.</li>
        </ul>
      </section>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="page">
      <h1>Help and definitions</h1>
      <HelpContent />
    </div>
  );
}
