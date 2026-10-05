import { useEffect, useMemo, useState } from "react";
import { formatNumber, parseScheme, type SchemeSettingsView, type ScoreOutput, type ScoresView, type ScoringScheme, type ScoringSettingsView } from "@myself-dashboard/core";
import { api, explain } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { useAnnounce } from "../../app/announcer";
import { Notice } from "../../components/States";
import { Icon } from "../../components/Icon";
import { saveBlob } from "../../lib/figureFiles";
import { OutputEditor } from "./OutputEditor";

/** Scoring settings (../ScoringSettings.tsx): one scheme, edited as a new version. */

const bump = (v: string) => {
  const [a, b] = v.split(".").map(Number);
  return `${a ?? 1}.${(b ?? 0) + 1}.0`;
};

// ── one scheme ────────────────────────────────────────────────────────────────

export function SchemeEditor({ entry, data, onSaved, onClose }: { entry: SchemeSettingsView; data: ScoringSettingsView; onSaved: (message: string) => void; onClose: () => void }) {
  const announce = useAnnounce();
  const canEdit = data.canEdit;
  const [draft, setDraft] = useState<ScoringScheme>(() => ({ ...entry.scheme, version: bump(entry.scheme.version) }));
  const [json, setJson] = useState<string | null>(null);
  const toggleJson = () => setJson(json === null ? JSON.stringify(draft, null, 2) : null);
  const [reason, setReason] = useState("");
  const [verify, setVerify] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const [preview, setPreview] = useState<ScoresView | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const parsed = useMemo(() => parseScheme(draft), [draft]);
  const errors = "errors" in parsed ? parsed.errors : [];
  const def = data.defaults.find((d) => d.key === entry.scheme.key) ?? null;
  const changed = JSON.stringify({ ...draft, version: "" }) !== JSON.stringify({ ...entry.scheme, version: "" });
  useEffect(() => setPreview(null), [draft]);

  const updateOutput = (i: number, o: ScoreOutput) => setDraft({ ...draft, outputs: draft.outputs.map((x, j) => (j === i ? o : x)) });
  const run = async (kind: "preview" | "save") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "preview") {
        setPreview(await api.getScores({ draft, groupBy: "none", observation: "latest" }));
      } else {
        const r = await api.saveScoringScheme({ scheme: draft, reason, markVerified: verify, verifyNote });
        announce(`Saved ${r.key} version ${r.version}`);
        onSaved(`Saved ${r.key} v${r.version}. Scores, reports and exports use it from now on; every earlier version is kept.`);
      }
    } catch (e) {
      setMessage({ tone: "warn", text: explain(e).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card scheme-editor" aria-labelledby="editor-h">
      <div className="card-head">
        <div>
          <h2 id="editor-h">
            {entry.scheme.name} <span className="muted">v{entry.scheme.version}</span>
          </h2>
          <p className="card-desc">
            {entry.source === "study" ? `Saved by ${entry.savedBy ?? "?"}, ${dateTime(entry.savedAt)}${entry.reason ? `: “${entry.reason}”` : ""}.` : "The dashboard's default, not yet changed for this study."}
            {entry.scheme.verified ? ` Verified by ${entry.scheme.verified.by} on ${entry.scheme.verified.at.slice(0, 10)}${entry.scheme.verified.note ? ` (${entry.scheme.verified.note})` : ""}.` : " Not yet verified."}
          </p>
        </div>
        <div className="card-tools">
          <button type="button" className="btn btn-small btn-quiet" onClick={() => saveBlob(new Blob([JSON.stringify(entry.scheme, null, 2)], { type: "application/json" }), `scoring_${entry.scheme.key}_v${entry.scheme.version}.json`)}>
            <Icon name="download" size={14} /> JSON
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={onClose} aria-label="Close the editor">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      {entry.checks.some((c) => c.issues.length) ? (
        <Notice tone="warn">
          <ul className="plain-list">
            {entry.checks.flatMap((c) => c.issues.map((i, n) => <li key={`${c.version}-${n}`}>v{c.version}: {i.message}</li>))}
          </ul>
        </Notice>
      ) : null}

      <p className="scheme-method">{draft.method}</p>
      {draft.notes ? <p className="muted small">{draft.notes}</p> : null}

      {draft.outputs.map((o, i) => (
        <OutputEditor key={o.key} output={o} canEdit={canEdit} onChange={(no) => updateOutput(i, no)} />
      ))}

      <div className="advanced">
        <button type="button" className="disclosure" aria-expanded={json !== null} onClick={toggleJson}>
          <Icon name={json === null ? "chevronRight" : "chevronDown"} size={14} />
          {canEdit ? "Edit everything as JSON (items, reversals, re-codings, new scores)" : "The whole scheme as JSON"}
        </button>
        {json !== null ? (
          <>
            <textarea className="json-editor" rows={18} value={json} readOnly={!canEdit} spellCheck={false} onChange={(e) => setJson(e.target.value)} aria-label="Scheme JSON" />
            {canEdit ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  try {
                    setDraft(JSON.parse(json) as ScoringScheme);
                    setMessage(null);
                  } catch (e) {
                    setMessage({ tone: "warn", text: `That is not valid JSON: ${(e as Error).message}` });
                  }
                }}
              >
                Apply JSON
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {entry.history.length ? (
        <details className="advanced">
          <summary>Versions ({entry.history.length})</summary>
          <ul className="plain-list history">
            {entry.history.map((h) => (
              <li key={h.version}>
                <strong>v{h.version}</strong> — {h.savedBy ?? "?"}, {dateTime(h.savedAt)}
                {h.verified ? " · verified" : ""}
                {h.reason ? <div className="muted small">{h.reason}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canEdit ? (
        <div className="save-block">
          {errors.length ? (
            <Notice tone="warn">
              <ul className="plain-list">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="field-row">
            <label>
              New version
              <input type="text" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} spellCheck={false} />
            </label>
            <label className="grow">
              Why (kept with the version)
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cut-offs checked against the youthinmind scoring sheet" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            I have checked this scheme against the instrument's licensed scoring documents
          </label>
          {verify ? (
            <label>
              What was checked (optional)
              <input type="text" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="e.g. youthinmind 'Scoring the SDQ', 2016 edition" />
            </label>
          ) : null}
          <div className="export-row">
            <button type="button" className="btn" disabled={busy !== null || errors.length > 0} onClick={() => void run("preview")}>
              Preview the effect
            </button>
            <button type="button" className="btn btn-primary" disabled={busy !== null || errors.length > 0 || reason.trim().length < 3 || (!changed && !verify)} onClick={() => void run("save")}>
              Save v{draft.version}
            </button>
            {def ? (
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => setDraft({ ...def, version: bump(entry.scheme.version) })}>
                Start again from the dashboard default
              </button>
            ) : null}
          </div>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {preview ? <PreviewTable before={entry.scheme} view={preview} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function PreviewTable({ before, view }: { before: ScoringScheme; view: ScoresView }) {
  const scheme = view.schemes[0]!;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Scores with this draft">
      <table className="data compact">
        <caption>With this draft, over every participant's latest sitting (all filters off)</caption>
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col" className="num">
              n
            </th>
            <th scope="col" className="num">
              Mean
            </th>
            <th scope="col">Bands</th>
          </tr>
        </thead>
        <tbody>
          {scheme.outputs.map((o) => {
            const r = view.results.find((x) => x.output === o.key);
            const s = r?.overall;
            const t = o.thresholds[0];
            return (
              <tr key={o.key}>
                <th scope="row">
                  {o.label}
                  {!before.outputs.some((b) => b.key === o.key) ? <span className="tag tag-quiet">new</span> : null}
                </th>
                <td className="num">{s ? formatNumber(s.n) : "–"}</td>
                <td className="num">{s ? formatNumber(s.mean, Math.max(1, o.decimals)) : "–"}</td>
                <td>{s && t ? t.bands.map((b, i) => `${b.label} ${Math.round((s.bands[t.key]?.[i]?.share ?? 0) * 100)}%`).join(" · ") : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
