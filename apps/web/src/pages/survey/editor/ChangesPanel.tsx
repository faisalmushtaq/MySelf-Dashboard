import { useEffect, useRef, useState } from "react";
import type { Change, Edit, Level, NextVersion, SurveyPreviewResponse } from "@myself-dashboard/core";
import { Dialog } from "../../../components/Dialog";
import { Icon } from "../../../components/Icon";
import { Notice } from "../../../components/States";
import { describeEdit } from "./describeEdit";

/**
 * What this draft changes, the version it would become, the survey's publish
 * checks, a preview on the real participant app, and — for owners — publish.
 */

const PARTICIPANT_URL = ((import.meta.env.VITE_PARTICIPANT_URL as string | undefined) ?? "https://faisalmushtaq.github.io/MySelf/").replace(/\/?$/, "/");

export function ChangesPanel({
  changes,
  next,
  edits,
  level,
  setLevel,
  onRemoveEdit,
  check,
  canPublish,
  onPublish,
}: {
  changes: Change[];
  next: NextVersion;
  edits: Edit[];
  level: Level | undefined;
  setLevel: (l: Level | undefined) => void;
  onRemoveEdit: (i: number) => void;
  check: () => Promise<SurveyPreviewResponse>;
  canPublish: boolean;
  onPublish: (notes: string) => Promise<void>;
}) {
  const [checked, setChecked] = useState<SurveyPreviewResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Record<string, unknown> | null>(null);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => setChecked(null), [edits, level]);

  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const r = await check();
      setChecked(r);
      return r;
    } catch (e) {
      setCheckError((e as Error).message);
      return null;
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="changes-panel">
      <div className="card">
        <h2>
          Would become v{next.version} <span className="tag">{next.level.toUpperCase()}</span>
        </h2>
        <p className="hint">{next.reasons.join(" ")}</p>
        <label>
          Version level
          <select value={level ?? ""} onChange={(e) => setLevel((e.target.value || undefined) as Level | undefined)}>
            <option value="">As the changes require ({next.required})</option>
            {(["minor", "major"] as Level[])
              .filter((l) => ["patch", "minor", "major"].indexOf(l) > ["patch", "minor", "major"].indexOf(next.required))
              .map((l) => (
                <option key={l} value={l}>
                  Raise to {l}
                </option>
              ))}
          </select>
        </label>
        <p className="hint">A version number can be raised, never lowered: two versions whose data cannot be pooled must not look as if they can (docs/06 §3 in the survey).</p>
      </div>

      <div className="card">
        <h2>
          {changes.length} change{changes.length === 1 ? "" : "s"} from the version it started from
        </h2>
        {changes.length === 0 ? (
          <p className="hint">Nothing yet.</p>
        ) : (
          <ul className="changes">
            {changes.map((c, i) => (
              <li key={i}>
                {c.summary} {c.participantVisible ? null : <span className="tag tag-quiet">researchers only</span>}
              </li>
            ))}
          </ul>
        )}
        {edits.length > 0 ? (
          <details>
            <summary>The {edits.length} edit{edits.length === 1 ? "" : "s"} that made them, in order</summary>
            <ol className="edit-list">
              {edits.map((e, i) => (
                <li key={i}>
                  {describeEdit(e)}{" "}
                  <button type="button" className="btn-link" onClick={() => onRemoveEdit(i)}>
                    undo this
                  </button>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>

      <div className="card">
        <h2>Check and try it</h2>
        <p className="hint">The dashboard's server rebuilds the draft with the survey's own release builder and runs its publish checks: licences, references, conditions, scoring, the MyStory protocol.</p>
        <div className="button-row">
          <button type="button" className="btn" disabled={checking || changes.length === 0} onClick={() => void runCheck()}>
            <Icon name="check" size={16} /> {checking ? "Checking…" : "Run the publish checks"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={checking || changes.length === 0}
            onClick={async () => {
              const r = checked ?? (await runCheck());
              if (r?.manifest) setPreviewing(r.manifest);
            }}
          >
            <Icon name="eye" size={16} /> Try it on the participant app
          </button>
        </div>
        {checkError ? <Notice tone="warn">{checkError}</Notice> : null}
        {checked ? (
          checked.failed ? (
            <Notice tone="warn">Edit {checked.failed.index + 1} no longer applies: {checked.failed.message}</Notice>
          ) : checked.problems.length > 0 ? (
            <Notice tone="warn">
              <strong>The publish checks refuse this draft:</strong>
              <ul>
                {checked.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <p className="ok-line">
              <Icon name="check" size={16} /> Passes every publish check as v{checked.next.version}.
            </p>
          )
        ) : null}
      </div>

      <div className="card">
        <h2>Publish</h2>
        {canPublish ? (
          <>
            <p>Publishing makes this the version every iPad uses for its next sitting. A sitting already under way finishes on the version it started with. It can be undone by making the previous version active again.</p>
            <button type="button" className="btn btn-primary" disabled={changes.length === 0} onClick={() => setPublishing(true)}>
              Publish v{next.version}…
            </button>
          </>
        ) : (
          <p className="hint">Only an owner can publish. Save the draft; an owner can open it from Survey versions.</p>
        )}
      </div>

      <PreviewDialog manifest={previewing} onClose={() => setPreviewing(null)} />
      <PublishDialog
        open={publishing}
        version={next.version}
        changes={changes.length}
        onClose={() => setPublishing(false)}
        onPublish={async (notes) => {
          const r = await runCheck();
          if (!r || r.failed || r.problems.length > 0) {
            setPublishing(false);
            return;
          }
          await onPublish(notes);
          setPublishing(false);
        }}
      />
    </div>
  );
}

/** The real participant app in preview mode, running the draft: nothing is stored or uploaded (survey D-54). */
function PreviewDialog({ manifest, onClose }: { manifest: Record<string, unknown> | null; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!manifest) return;
    const origin = new URL(PARTICIPANT_URL).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || (e.data as { type?: string })?.type !== "myself:preview-ready") return;
      frame.current?.contentWindow?.postMessage({ type: "myself:preview-manifest", manifest }, origin);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [manifest]);
  return (
    <Dialog open={manifest !== null} onClose={onClose} title="Try the draft" wide>
      <p className="hint">The participant app, running this draft. Nothing you enter is saved or sent anywhere.</p>
      <iframe ref={frame} className="preview-frame" title="The participant app, previewing the draft" src={`${PARTICIPANT_URL}?preview=1`} />
    </Dialog>
  );
}

function PublishDialog({ open, version, changes, onClose, onPublish }: { open: boolean; version: string; changes: number; onClose: () => void; onPublish: (notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Publish v${version}`}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || notes.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onPublish(notes.trim());
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Publishing…" : `Publish v${version} to every iPad`}
          </button>
        </>
      }
    >
      <p>
        {changes} change{changes === 1 ? "" : "s"}. The survey's publish checks run once more first. Once published, v{version} is frozen: a later change makes a new version.
      </p>
      <label>
        Why this version (kept with it, and in the exported history)
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </label>
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Dialog>
  );
}
