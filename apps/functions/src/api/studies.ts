import { accessListProblem, readAccessList, type StudyAccessResponse, type StudyAccessView, type SurveysResponse } from "@myself-dashboard/core";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireActor, requireStudyActor } from "../authz.js";
import { dash, DEFAULT_STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { invalidateSettings, studyAccessList } from "../settings.js";
import { registeredStudies, studySurveys, studyView } from "../studies.js";
import { callableOptions } from "./common.js";

/**
 * Study spaces (docs/12): the surveys of the study someone is working in, and,
 * for administrators, who else may see each study.
 */

/** The study's surveys, for the survey filter and the Survey versions page. */
export const getSurveys = onCall(callableOptions, async (request): Promise<SurveysResponse> => {
  const actor = await requireStudyActor(request);
  const fresh = (request.data as Record<string, unknown> | null)?.["fresh"] === true;
  return { study: actor.study, surveys: await studySurveys(actor.study, fresh) };
});

const iso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : null);

/** Every study and who else may see it: Settings → Study access (administrators). */
export const getStudyAccess = onCall(callableOptions, async (request): Promise<StudyAccessResponse> => {
  await requireActor(request, "settings.access");
  const studies: StudyAccessView[] = [];
  for (const s of await registeredStudies(true)) {
    const snap = s.isDefault ? null : await dash().doc(dpaths.studyAccess(s.study)).get();
    studies.push({
      ...(await studyView(s)),
      list: s.isDefault ? null : snap?.exists ? readAccessList(snap.data()) : { emails: [], domains: [] },
      updatedAt: iso(snap?.get("updatedAt")),
      updatedBy: (snap?.get("updatedByEmail") as string | undefined) ?? null,
    });
  }
  return { studies };
});

/**
 * Who else may see a study: addresses and Google Workspace domains, never a
 * public mail service as a domain. Not the default study, whose list is the
 * dashboard's own (Settings → Access). Audited in the study's own log, with
 * the list before and after.
 */
export const updateStudyAccess = onCall(callableOptions, async (request): Promise<StudyAccessView> => {
  const actor = await requireStudyActor(request, "settings.access");
  if (actor.study === DEFAULT_STUDY) {
    throw new HttpsError("failed-precondition", "Everyone on the dashboard's access list sees the default study. Change that list under Settings → Access.");
  }
  const next = readAccessList(request.data);
  const problem = accessListProblem(next);
  if (problem) throw new HttpsError("invalid-argument", problem);
  const before = (await studyAccessList(actor.study, true)) ?? { emails: [], domains: [] };
  await dash().doc(dpaths.studyAccess(actor.study)).set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedByEmail: actor.email });
  invalidateSettings();
  await audit({ action: "study_access.changed", ...actorFields(actor), target: { type: "study", id: actor.study }, detail: { before, after: next } });
  const s = (await registeredStudies(true)).find((x) => x.study === actor.study) ?? { study: actor.study, title: null, status: "closed" as const, isDefault: false };
  return { ...(await studyView(s)), list: next, updatedAt: new Date().toISOString(), updatedBy: actor.email };
});
