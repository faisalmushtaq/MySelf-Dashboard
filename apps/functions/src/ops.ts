import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { audit } from "./audit.js";
import { DASHBOARD_DATABASE, REGION } from "./env.js";
import { resetStore } from "./store.js";
import { rebuildAll } from "./summaries.js";

/**
 * Operations requested by the deploy workflow, run inside Google Cloud.
 *
 * The first deployment must summarise every sitting already in the survey
 * database. That reads raw logs, so it runs here, in europe-west2 next to the
 * data, rather than on a CI runner: the workflow only creates a request
 * document and waits for its result. Requests can be created with server
 * credentials only — the dashboard rules deny every client access to `ops/`.
 */

export const OPS_KINDS = ["rebuild_summaries"] as const;

export const onOpsRequest = onDocumentCreated(
  { document: "ops/{requestId}", database: DASHBOARD_DATABASE, region: REGION, memory: "1GiB", timeoutSeconds: 540, retry: false },
  async (event) => handleOpsRequest(event.data?.ref, event.data?.data()),
);

export async function handleOpsRequest(ref: FirebaseFirestore.DocumentReference | undefined, data: Record<string, unknown> | undefined): Promise<void> {
  if (!ref || !data) return;
  const kind = data["kind"];
  const requestedBy = typeof data["requestedBy"] === "string" ? (data["requestedBy"] as string).slice(0, 120) : "unknown";
  if (kind !== "rebuild_summaries") {
    await ref.update({ status: "rejected", reason: "unknown request kind", finishedAt: FieldValue.serverTimestamp() });
    return;
  }
  await ref.update({ status: "running", startedAt: FieldValue.serverTimestamp() });
  try {
    const result = await rebuildAll();
    resetStore();
    await ref.update({ status: "done", ...result, finishedAt: FieldValue.serverTimestamp() });
    await audit({ action: "summaries.rebuilt", actorUid: null, actorEmail: null, actorRole: null, detail: { ...result, via: "ops request", requestedBy } });
    logger.info("ops request done", { kind, ...result });
  } catch (error) {
    logger.error("ops request failed", { kind, error: String(error) });
    await ref.update({ status: "failed", error: String(error).slice(0, 300), finishedAt: FieldValue.serverTimestamp() });
  }
}
