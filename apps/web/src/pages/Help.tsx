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
        <h3>Scores and school reports</h3>
        <p>
          The Scores page scores each instrument with the study's scoring schemes — the published method where there is one, a labelled study summary where there
          is not — and reads the scores against published threshold bands and benchmarks, by school, year group, gender or wave. Choose a school (and year group) to
          see it against its peers, and make a school report to share: averages only, other schools never named, small groups withheld. How each score is
          calculated, and every version of it, is in Settings → Scoring; cut-points and norms are marked unverified until an administrator has checked them against
          the licensed scoring documents.
        </p>
        <h3>Codebook and quality review</h3>
        <p>
          Every question has a readable name (<code>sdq_13_unhappy</code>) and a short label, used on screen and as the column names of every export; the
          survey&apos;s own variable and the original Qualtrics name are kept beside them. The Codebook page shows each question&apos;s wording and codes and what
          each answer scores, and reviews every survey version automatically: answers that do not score as their labels say, scoring keys that differ from the
          published ones, codes whose meaning changed between versions, and wording that differs from the published forms. Errors need fixing before analysis;
          warnings need a decision or care.
        </p>
        <h3>Participants and exports</h3>
        <p>
          The Participants page joins sittings into participants by the survey&apos;s secret code, exactly as the survey&apos;s own export does, and numbers
          each participant&apos;s sittings as waves. It lists what the linkage could not settle: sittings held back (for example an incomplete secret code),
          codes two children share (almost always twins) and sittings less than a day apart. Codes are corrected and twins separated in the survey&apos;s
          researcher tool (Linkage tab); the dashboard never changes a link. Read-only reviewers see labels (P0001…) instead of codes.
        </p>
        <p>
          Session exports default to a BIDS dataset with identifiers (participant code, wave, study code, session id) so the data can be linked to other
          records; <code>linkage.tsv</code> holds the identifiers and is kept out of what a BIDS validator reads. Untick &ldquo;Include identifiers&rdquo; for a
          de-identified copy. Names, dates of birth, UPNs, NHS numbers and the secret-code answers are never exported by the dashboard.
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
