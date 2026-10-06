import { randomUUID } from "node:crypto";
import {
  applyReviewChange,
  emptyReview,
  REVIEW_STATUSES,
  ReviewError,
  validateNote,
  type ReviewChange,
  type ReviewDoc,
} from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, auditIn } from "../audit.js";
import { requireStudyActor } from "../authz.js";
import { dash, research } from "../env.js";
import { dpaths, spaths } from "../paths.js";
import { sittingStudyProblem } from "../sittings.js";
import { callableOptions, sessionIdArg } from "./common.js";

/**
 * Review tools. The review record lives in the dashboard database and never
 * touches the participant's response; every change and its audit row are written
 * in ONE transaction, so there is no change without a trail and no trail without
 * a change. Rules deny clients any direct write to reviews or notes.
 */

function parseChange(raw: unknown): ReviewChange {
  if (!raw || typeof raw !== "object") throw new HttpsError("invalid-argument", "no change given");
  const c = raw as Record<string, unknown>;
  switch (c["kind"]) {
    case "set_status":
      if (!(REVIEW_STATUSES as readonly string[]).includes(c["status"] as string)) throw new HttpsError("invalid-argument", "unknown review status");
      return { kind: "set_status", status: c["status"] as ReviewDoc["status"] };
    case "add_flag":
      return { kind: "add_flag", reason: String(c["reason"]) as never, note: typeof c["note"] === "string" ? c["note"] : null };
    case "resolve_flag":
    case "reopen_flag":
      return { kind: c["kind"], flagId: String(c["flagId"] ?? "") };
    case "set_quality":
      return { kind: "set_quality", concerns: Array.isArray(c["concerns"]) ? (c["concerns"] as unknown[]).map(String).slice(0, 20) : [] };
    case "mark_test":
    case "mark_invalid":
      return { kind: c["kind"], value: c["value"] === true };
    default:
      throw new HttpsError("invalid-argument", "unknown kind of change");
  }
}

/** A review is only ever of a sitting in the study it is filed under. */
async function requireSession(study: string, sessionId: string): Promise<void> {
  const snap = await research().doc(spaths.session(study, sessionId)).get();
  if (!snap.exists || sittingStudyProblem(study, snap.data() as Record<string, unknown>)) throw new HttpsError("not-found", "No session with that id exists in this study.");
}

export const updateReview = onCall(callableOptions, async (request): Promise<{ review: ReviewDoc }> => {
  const actor = await requireStudyActor(request, "review.write");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const sessionId = sessionIdArg(data["sessionId"]);
  const change = parseChange(data["change"]);
  const expectedRev = typeof data["expectedRev"] === "number" ? data["expectedRev"] : null;
  await requireSession(actor.study, sessionId);
  const db = dash();
  const ref = db.doc(dpaths.review(actor.study, sessionId));
  try {
    const review = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current: ReviewDoc = snap.exists ? ({ ...emptyReview(sessionId), ...(snap.data() as Partial<ReviewDoc>) } as ReviewDoc) : emptyReview(sessionId);
      delete (current as unknown as Record<string, unknown>)["_ts"];
      if (expectedRev !== null && current.rev !== expectedRev) {
        throw new HttpsError("aborted", "Someone else changed this review a moment ago. The latest version has been loaded — check it and try again.");
      }
      const { next, before, after } = applyReviewChange(current, change, { uid: actor.uid, email: actor.email }, new Date(), () => randomUUID());
      tx.set(ref, { ...next, _ts: FieldValue.serverTimestamp() });
      auditIn(tx, {
        action: "review.updated",
        ...actorFields(actor),
        target: { type: "session", id: sessionId },
        detail: { change: change.kind, before, after, rev: next.rev },
      });
      return next;
    });
    return { review };
  } catch (error) {
    if (error instanceof ReviewError) throw new HttpsError("invalid-argument", error.message);
    throw error;
  }
});

export const addNote = onCall(callableOptions, async (request): Promise<{ id: string; noteCount: number }> => {
  const actor = await requireStudyActor(request, "review.write");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const sessionId = sessionIdArg(data["sessionId"]);
  let text: string;
  try {
    text = validateNote(data["text"]);
  } catch (error) {
    throw new HttpsError("invalid-argument", (error as Error).message);
  }
  await requireSession(actor.study, sessionId);
  const db = dash();
  const reviewRef = db.doc(dpaths.review(actor.study, sessionId));
  const noteRef = db.collection(dpaths.notes(actor.study, sessionId)).doc();
  const noteCount = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reviewRef);
    const current: ReviewDoc = snap.exists ? ({ ...emptyReview(sessionId), ...(snap.data() as Partial<ReviewDoc>) } as ReviewDoc) : emptyReview(sessionId);
    delete (current as unknown as Record<string, unknown>)["_ts"];
    tx.create(noteRef, { text, authorUid: actor.uid, authorEmail: actor.email, createdAt: FieldValue.serverTimestamp() });
    const count = current.noteCount + 1;
    tx.set(reviewRef, { ...current, noteCount: count, updatedAt: new Date().toISOString(), updatedBy: actor.uid, rev: current.rev + 1, _ts: FieldValue.serverTimestamp() });
    auditIn(tx, {
      action: "note.added",
      ...actorFields(actor),
      target: { type: "session", id: sessionId },
      // The note itself is immutable and kept beside the review; the audit row
      // records that it was written, by whom and how long it is.
      detail: { noteId: noteRef.id, length: text.length },
    });
    return count;
  });
  return { id: noteRef.id, noteCount };
});
