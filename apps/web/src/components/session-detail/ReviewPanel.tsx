import { useState, type FormEvent } from "react";
import { FLAG_REASONS, QUALITY_CONCERNS, REVIEW_STATUS_LABELS, REVIEW_STATUSES, type ReviewChange, type ReviewDoc, type SessionDetailResponse } from "@myself-dashboard/core";
import { api, explain } from "../../lib/api";
import { dateTime, relative } from "../../lib/format";
import { useAnnounce } from "../../app/announcer";
import { Icon } from "../Icon";
import { Notice } from "../States";

/** Session detail (../SessionDetail.tsx): review status, flags, data-quality concerns, exclusions and notes. */

export function ReviewPanel({ detail, onChange, onNoteAdded }: { detail: SessionDetailResponse; onChange: (r: ReviewDoc) => void; onNoteAdded: () => void }) {
  const announce = useAnnounce();
  const canReview = detail.permissions.review;
  const review = detail.review;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(FLAG_REASONS[0].id);
  const [flagNote, setFlagNote] = useState("");
  const [note, setNote] = useState("");

  const change = async (c: ReviewChange, success: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.updateReview({ sessionId: detail.item.sessionId, change: c, expectedRev: review.rev });
      onChange(r.review);
      announce(success, "success");
    } catch (e) {
      const m = explain(e);
      setErr(m.message);
      announce(m.message, "error");
      if (m.code === "aborted") onNoteAdded();
    } finally {
      setBusy(false);
    }
  };

  const addFlag = async (e: FormEvent) => {
    e.preventDefault();
    await change({ kind: "add_flag", reason: reason as never, note: flagNote || null }, "Flag added.");
    setFlagNote("");
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.addNote({ sessionId: detail.item.sessionId, text: note });
      setNote("");
      announce("Note added.", "success");
      onNoteAdded();
    } catch (x) {
      setErr(explain(x).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="review-panel card" aria-label="Review">
      <h3>Review</h3>
      {!canReview ? <p className="hint">Your role can read reviews but not change them.</p> : null}
      <p className="hint">Flags and notes are kept apart from the participant's answers and never change them. Every change is recorded in the audit log.</p>
      {err ? <Notice tone="warn">{err}</Notice> : null}
      <label>
        Review status
        <select
          value={review.status}
          disabled={!canReview || busy}
          onChange={(e) => void change({ kind: "set_status", status: e.target.value as ReviewDoc["status"] }, `Review status set to ${REVIEW_STATUS_LABELS[e.target.value as ReviewDoc["status"]]}.`)}
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REVIEW_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {review.lastReviewedAt ? <p className="hint">Last marked reviewed {relative(review.lastReviewedAt)}.</p> : null}
      {canReview && review.status !== "reviewed" ? (
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void change({ kind: "set_status", status: "reviewed" }, "Marked as reviewed.")}>
          <Icon name="check" size={14} /> Mark as reviewed
        </button>
      ) : null}

      <h4>Flags</h4>
      {review.flags.length === 0 ? <p className="hint">No flags.</p> : null}
      <ul className="flags">
        {review.flags.map((f) => (
          <li key={f.id} className={f.open ? "flag-open" : "flag-closed"}>
            <div>
              <Icon name="flag" size={14} /> <strong>{FLAG_REASONS.find((r) => r.id === f.reason)?.label ?? f.reason}</strong>
              {f.open ? "" : " (resolved)"}
              {f.note ? <p>{f.note}</p> : null}
              <span className="hint">
                {f.createdByEmail ?? "someone"}, {relative(f.createdAt)}
              </span>
            </div>
            {canReview ? (
              <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => void change({ kind: f.open ? "resolve_flag" : "reopen_flag", flagId: f.id }, f.open ? "Flag resolved." : "Flag reopened.")}>
                {f.open ? "Resolve" : "Reopen"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canReview ? (
        <form className="flag-form" onSubmit={(e) => void addFlag(e)}>
          <label>
            Flag reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {FLAG_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note (optional{reason === "other" ? " — required for Other" : ""})
            <input type="text" maxLength={1000} value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-small" disabled={busy}>
            <Icon name="flag" size={14} /> Add flag
          </button>
        </form>
      ) : null}

      <fieldset className="check-list" disabled={!canReview || busy}>
        <legend>Data-quality concerns</legend>
        {QUALITY_CONCERNS.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={review.qualityConcerns.includes(c.id)}
              onChange={() =>
                void change(
                  { kind: "set_quality", concerns: review.qualityConcerns.includes(c.id) ? review.qualityConcerns.filter((x) => x !== c.id) : [...review.qualityConcerns, c.id] },
                  "Data-quality concerns updated.",
                )
              }
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="check-list" disabled={!canReview || busy}>
        <legend>Exclusions</legend>
        <label>
          <input type="checkbox" checked={review.markedTest} onChange={(e) => void change({ kind: "mark_test", value: e.target.checked }, e.target.checked ? "Marked as a test session." : "No longer marked as test.")} />
          Test session (excluded from production data)
        </label>
        <label>
          <input type="checkbox" checked={review.markedInvalid} onChange={(e) => void change({ kind: "mark_invalid", value: e.target.checked }, e.target.checked ? "Marked invalid." : "No longer marked invalid.")} />
          Invalid (excluded from completion rates)
        </label>
      </fieldset>

      <h4>Research notes</h4>
      {detail.notes.length === 0 ? <p className="hint">No notes yet.</p> : null}
      <ol className="notes">
        {detail.notes.map((n) => (
          <li key={n.id}>
            <p>{n.text}</p>
            <span className="hint">
              {n.authorEmail ?? "someone"} · {dateTime(n.createdAt)}
            </span>
          </li>
        ))}
      </ol>
      {canReview ? (
        <form onSubmit={(e) => void addNote(e)} className="note-form">
          <label>
            Add a note
            <textarea rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="hint">Notes are permanent and cannot be edited or deleted. Do not write names or other identifying details.</p>
          <button type="submit" className="btn btn-small" disabled={busy || note.trim().length === 0}>
            <Icon name="note" size={14} /> Add note
          </button>
        </form>
      ) : null}
    </aside>
  );
}
