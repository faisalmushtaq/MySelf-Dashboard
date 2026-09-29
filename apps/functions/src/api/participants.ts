import { can, type ParticipantsResponse } from "@myself-dashboard/core";
import { participantsOverview } from "@myself-dashboard/core/survey";
import { onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireActor } from "../authz.js";
import { currentRows } from "../store.js";
import { loadStudyDataset } from "../studyData.js";
import { callableOptions } from "./common.js";

/**
 * The Participants page: every participant code with its sittings in wave
 * order, and what the linkage could not settle. Codes go only to roles that may
 * see them; everyone else gets labels. Nothing here changes a link — those
 * repairs are made in the survey's researcher tool, where the names are.
 */
export const getParticipants = onCall({ ...callableOptions, memory: "1GiB", timeoutSeconds: 120 }, async (request): Promise<ParticipantsResponse> => {
  const actor = await requireActor(request);
  const fresh = (request.data as { fresh?: unknown } | null)?.fresh === true;
  const now = new Date();
  const [{ study }, { rows }] = await Promise.all([loadStudyDataset({ fresh }), currentRows(now)]);
  const byId = new Map(rows.map((r) => [r.summary.sessionId, r]));
  const codesShown = can(actor.role, "view.participantCode", actor.policy);
  const out = participantsOverview(
    study,
    (id) => {
      const r = byId.get(id);
      return r ? { status: r.status.display, releaseVersion: r.summary.releaseVersion, site: r.summary.site, startedAt: r.summary.startedAt } : undefined;
    },
    { codesShown, now },
  );
  await audit({
    action: "participants.viewed",
    ...actorFields(actor),
    target: { type: "study", id: "participants" },
    // Counts only: the log need not hold a second copy of every code.
    detail: { participants: out.totals.participants, codesShown, fresh },
  });
  return out;
});
