import { useState } from "react";
import { formatNumber, YEAR_GROUP_SOURCE_LABELS, YEAR_GROUP_SOURCES, type GroupSettings, type ScoringSettingsView, type YearGroupSource } from "@myself-dashboard/core";
import { api, explain } from "../../lib/api";
import { useAnnounce } from "../../app/announcer";
import { Notice } from "../../components/States";

/** Scoring settings (../ScoringSettings.tsx): how sittings are grouped into schools and year groups. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── schools and year groups ───────────────────────────────────────────────────

export function GroupsCard({ data, onSaved }: { data: ScoringSettingsView; onSaved: () => void }) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState<GroupSettings>(data.groups);
  const [rules, setRules] = useState(data.groups.yearGroup.rules.map((r) => `${r.pattern} = ${r.yearGroup}`).join("\n"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const canEdit = data.canEdit;
  const stats = data.groupStats;
  const parsedRules = rules
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.+?)\s*=\s*(\d{1,2})$/.exec(l);
      return m ? { pattern: m[1]!.trim(), yearGroup: Number(m[2]) } : null;
    });
  const badRules = parsedRules.filter((r) => r === null).length;
  const toggle = (s: YearGroupSource) => {
    const order = draft.yearGroup.order.includes(s) ? draft.yearGroup.order.filter((x) => x !== s) : YEAR_GROUP_SOURCES.filter((x) => x === s || draft.yearGroup.order.includes(x));
    setDraft({ ...draft, yearGroup: { ...draft.yearGroup, order } });
  };
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const settings: GroupSettings = { ...draft, yearGroup: { ...draft.yearGroup, rules: parsedRules.filter((r): r is { pattern: string; yearGroup: number } => r !== null) } };
      await api.saveGroupSettings({ settings, reason });
      setMessage({ tone: "info", text: "Saved. Scores and reports use these groups from now on." });
      announce("School and year-group settings saved");
      onSaved();
    } catch (e) {
      setMessage({ tone: "warn", text: explain(e).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="groups-h">
      <h2 id="groups-h">Schools and year groups</h2>
      <p className="hint">
        A sitting's school is the site its study code opens with. The survey does not ask for a year group, so it is taken from the first of these that gives one. Of{" "}
        {formatNumber(stats.sittings)} linked sittings: {YEAR_GROUP_SOURCES.map((s) => `${formatNumber(stats.yearGroupSources[s])} by ${YEAR_GROUP_SOURCE_LABELS[s].toLowerCase()}`).join(", ")}, and{" "}
        {formatNumber(stats.yearGroupSources.unknown)} unknown.
      </p>
      <fieldset className="check-list" disabled={!canEdit}>
        <legend>Year group comes from (in this order)</legend>
        {YEAR_GROUP_SOURCES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={draft.yearGroup.order.includes(s)} onChange={() => toggle(s)} /> {YEAR_GROUP_SOURCE_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <div className="settings-grid">
        <label>
          Study-code rules (one per line: <code>pattern = year</code>, e.g. <code>^NDC08 = 8</code>)
          <textarea rows={4} value={rules} onChange={(e) => setRules(e.target.value)} spellCheck={false} disabled={!canEdit} />
          {badRules ? <span className="hint warn-text">{badRules} line{badRules === 1 ? "" : "s"} not in the form “pattern = year”.</span> : null}
        </label>
        <label>
          Year-group question variable
          <input type="text" value={draft.yearGroup.itemVariable} onChange={(e) => setDraft({ ...draft, yearGroup: { ...draft.yearGroup, itemVariable: e.target.value } })} disabled={!canEdit} />
        </label>
        <label>
          School year starts in
          <select value={draft.yearGroup.startMonth} onChange={(e) => setDraft({ ...draft, yearGroup: { ...draft.yearGroup, startMonth: Number(e.target.value) } })} disabled={!canEdit}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
                {i === 8 ? " (England and Wales)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Smallest group to report on its own
          <input type="number" min={3} max={50} value={draft.minCell} onChange={(e) => setDraft({ ...draft, minCell: Number(e.target.value) })} disabled={!canEdit} />
          <span className="hint">Smaller groups are marked in the dashboard and left out of reports for schools.</span>
        </label>
      </div>
      <h3>School names</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Schools">
        <table className="data compact">
          <caption className="sr-only">Schools</caption>
          <thead>
            <tr>
              <th scope="col">Site code</th>
              <th scope="col" className="num">
                Sittings
              </th>
              <th scope="col">Name shown in scores and reports</th>
            </tr>
          </thead>
          <tbody>
            {stats.schools.map((s) => (
              <tr key={s.key}>
                <th scope="row">
                  <code>{s.key}</code>
                </th>
                <td className="num">{formatNumber(s.n)}</td>
                <td>
                  <input
                    type="text"
                    value={draft.schools[s.key] ?? ""}
                    placeholder={s.key}
                    disabled={!canEdit}
                    aria-label={`Name for ${s.key}`}
                    onChange={(e) => {
                      const schools = { ...draft.schools };
                      if (e.target.value.trim()) schools[s.key] = e.target.value;
                      else delete schools[s.key];
                      setDraft({ ...draft, schools });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="save-block">
          <label>
            Why (kept in the audit log)
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. School names from the fieldwork plan" />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 3 || badRules > 0 || draft.yearGroup.order.length === 0} onClick={() => void save()}>
            Save schools and year groups
          </button>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </div>
      ) : null}
    </section>
  );
}
