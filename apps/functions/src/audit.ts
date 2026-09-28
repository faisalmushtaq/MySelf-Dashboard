import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { dash } from "./env.js";
import { dpaths } from "./paths.js";

/**
 * The dashboard's audit log: append-only, written only here (the rules deny every
 * client write), readable by administrators in full and by everyone else for
 * their own entries.
 *
 * Details carry ids, counts and settings — never answers, free text or names.
 */

export type AuditAction =
  | "auth.signed_in"
  | "auth.denied"
  | "session.viewed"
  | "review.updated"
  | "note.added"
  | "export.previewed"
  | "export.created"
  | "export.failed"
  | "export.downloaded"
  | "export.download_denied"
  | "chart_data.downloaded"
  | "role.changed"
  | "access_policy.changed"
  | "policy.changed"
  | "summaries.rebuilt"
  | "release.registered";

export interface AuditEntry {
  action: AuditAction;
  actorUid: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  target?: { type: string; id: string } | null;
  detail?: Record<string, unknown> | null;
  outcome?: "success" | "denied" | "failed";
}

function row(entry: AuditEntry) {
  return {
    action: entry.action,
    actorUid: entry.actorUid,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    target: entry.target ?? null,
    detail: entry.detail ?? null,
    outcome: entry.outcome ?? "success",
    at: FieldValue.serverTimestamp(),
  };
}

export async function audit(entry: AuditEntry, db: Firestore = dash()): Promise<void> {
  try {
    await db.collection(dpaths.audit()).add(row(entry));
  } catch (error) {
    // A failed audit write is logged loudly. For actions whose audit row is part of
    // the action (reviews, notes, exports), the row is written in the same
    // transaction instead, so this path cannot drop it.
    logger.error("audit write failed", { action: entry.action, error: String(error) });
  }
}

/** Audit inside a transaction: the row exists if and only if the change does. */
export function auditIn(tx: Transaction, entry: AuditEntry, db: Firestore = dash()): void {
  tx.create(db.collection(dpaths.audit()).doc(), row(entry));
}

export const actorFields = (a: { uid: string; email: string; role: string }) => ({
  actorUid: a.uid,
  actorEmail: a.email,
  actorRole: a.role,
});
