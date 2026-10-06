import { can, sanitiseFilters, type ParticipantsResponse } from "@myself-dashboard/core";
import { participantsOverview, subsetDataset } from "@myself-dashboard/core/survey";
import { onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireStudyActor } from "../authz.js";
import { currentRows } from "../store.js";
import { loadStudyDataset } from "../studyData.js";
import { callableOptions } from "./common.js";

/**
 * The Participants page: every participant code with its sittings in wave
 * order, and what the linkage could not settle. Codes go only to roles that may
 * see them; everyone else gets labels. Nothing here changes a link — those
 * repairs are made in the survey's researcher tool, where the names are.
 *
 * With a survey chosen (docs/12 §12.6), the participants with a sitting in that
 * survey, and only those sittings; waves keep the numbers the study-wide
 * linkage gave them.
 */
export const getParticipants = onCall({ ...callableOptions, memory: "1GiB", timeoutSeconds: 120 }, async (request): Promise<ParticipantsResponse> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as { fresh?: unknown; filters?: unknown };
  const fresh = data.fresh === true;
  const surveys = sanitiseFilters(data.filters).surveys;
  const now = new Date();
  const [{ study: linked }, { rows }] = await Promise.all([loadStudyDataset(actor.study, { fresh }), currentRows(actor.study, now)]);
  const byId = new Map(rows.map((r) => [r.summary.sessionId, r]));
  const chosen = new Set(rows.filter((r) => r.survey && surveys.includes(r.survey)).map((r) => r.summary.sessionId));
  const study = surveys.length === 0 ? linked : { ...linked, dataset: subsetDataset(linked.dataset, chosen), excluded: linked.excluded.filter((e) => chosen.has(e.sessionId)), collisions: linked.collisions.filter((c) => c.sessionIds.some((id) => chosen.has(id))) };
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
    detail: { participants: out.totals.participants, codesShown, fresh, ...(surveys.length ? { surveys } : {}) },
  });
  return out;
});
