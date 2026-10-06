import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { audit } from "./audit.js";
import { DASHBOARD_DATABASE, REGION } from "./env.js";
import { resetStore } from "./store.js";
import { lookupStudy } from "./studies.js";
import { rebuildAll, rebuildEveryStudy } from "./summaries.js";

/**
 * Operations requested by the Firebase setup workflow (`scripts/firebase-ops.mjs
 * finish`, run by .github/workflows/firebase-setup.yml), run inside Google Cloud.
 *
 * The first deployment must summarise every sitting already in the survey
 * database. That reads raw logs, so it runs here, in europe-west2 next to the
 * data, rather than on a CI runner: the workflow only creates a request
 * document and waits for its result. Requests can be created with server
 * credentials only — the dashboard rules deny every client access to `ops/`.
 *
 * A request may name a `study`; without one, every registered study is
 * rebuilt (docs/12 §12.5).
 */

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
  let study: string | null = null;
  if (data["study"] !== undefined) {
    const found = await lookupStudy(data["study"]);
    if (found.kind !== "registered") {
      await ref.update({ status: "rejected", reason: "not a registered study", finishedAt: FieldValue.serverTimestamp() });
      return;
    }
    study = found.study;
  }
  await ref.update({ status: "running", startedAt: FieldValue.serverTimestamp() });
  try {
    const one = study ? await rebuildAll(study) : null;
    const result = study && one ? { ...one, studies: { [study]: one } } : await rebuildEveryStudy();
    resetStore();
    await ref.update({ status: "done", ...result, finishedAt: FieldValue.serverTimestamp() });
    await audit({ action: "summaries.rebuilt", actorUid: null, actorEmail: null, actorRole: null, detail: { ...result, via: "ops request", requestedBy } });
    logger.info("ops request done", { kind, scanned: result.scanned, written: result.written });
  } catch (error) {
    logger.error("ops request failed", { kind, error: String(error) });
    await ref.update({ status: "failed", error: String(error).slice(0, 300), finishedAt: FieldValue.serverTimestamp() });
  }
}
