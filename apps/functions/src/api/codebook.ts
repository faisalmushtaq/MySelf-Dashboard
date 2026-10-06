import { buildQualityReport, compareVersions, sanitiseFilters, type CodebookResponse } from "@myself-dashboard/core";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireStudyActor } from "../authz.js";
import { allReleaseIndexes } from "../releases.js";
import { effectiveSchemes } from "../scoring.js";
import { callableOptions } from "./common.js";

/**
 * The codebook of one survey version — every question's readable name, label,
 * wording, codes and what each code scores — and the quality review of every
 * registered version against the study's current scoring schemes.
 *
 * Built from the survey definitions and the schemes alone: no answers are read,
 * so every member of the study sees the same thing. With a survey chosen, that
 * survey's versions only (docs/12 §12.6).
 */
export const getCodebook = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<CodebookResponse> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const surveys = sanitiseFilters(data["filters"]).surveys;
  const [all, schemes] = await Promise.all([allReleaseIndexes(actor.study), effectiveSchemes(actor.study)]);
  const releases = all.filter((r) => surveys.length === 0 || (r.survey !== null && surveys.includes(r.survey)));
  if (!releases.length) throw new HttpsError("failed-precondition", "No survey versions are registered yet.");
  const ordered = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  const active = ordered.find((r) => r.hash === actor.policy.activeReleaseHash) ?? ordered[0]!;
  const wanted = typeof data["release"] === "string" ? ordered.find((r) => r.hash === data["release"]) : undefined;
  const release = wanted ?? active;
  return {
    ...buildQualityReport({ releases, release, schemes }),
    releases: ordered.map((r) => ({ hash: r.hash, version: r.version, active: r.hash === active.hash })),
  };
});
