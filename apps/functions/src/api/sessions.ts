import {
  buildSummary,
  can,
  compareVersions,
  definitionsFrom,
  deriveStatus,
  emptyReview,
  neighbours,
  orderedRows,
  PAGE_SIZES,
  presentAnswers,
  runQuery,
  sanitiseFilters,
  sanitiseSort,
  toListItem,
  type NoteView,
  type QuerySessionsResponse,
  type ReviewDoc,
  type SessionDetailResponse,
} from "@myself-dashboard/core";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { requireStudyActor } from "../authz.js";
import { dash } from "../env.js";
import { dpaths } from "../paths.js";
import { allReleaseIndexes, releaseIndex, releaseList } from "../releases.js";
import { readSitting } from "../sittings.js";
import { currentRows } from "../store.js";
import { callableOptions, clampInt, releaseView, searchArg, sessionIdArg } from "./common.js";

const iso = (v: unknown): string | null =>
  v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : null;

/** The session directory: filtered, searched, sorted and paged on the server. */
export const querySessions = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<QuerySessionsResponse> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const now = new Date();
  const [{ rows }, releases] = await Promise.all([currentRows(actor.study, now), allReleaseIndexes(actor.study)]);
  const defs = definitionsFrom(releases);
  const studyCodes = can(actor.role, "view.studyCode", actor.policy);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(data["pageSize"] as number) ? (data["pageSize"] as number) : 50;
  const result = runQuery(
    rows,
    {
      filters: sanitiseFilters(data["filters"]),
      sort: sanitiseSort(data["sort"]),
      search: searchArg(data["search"]),
      page: clampInt(data["page"], 1, 100_000, 1),
      pageSize,
    },
    { now, timeZone: actor.policy.timeZone },
    { studyCodes },
  );
  return {
    items: result.rows.map((r) => toListItem(r, { studyCodes, sectionTitle: defs.section })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    pageCount: result.pageCount,
    computedAt: now.toISOString(),
  };
});

/**
 * One sitting, in full, in the wording of the survey version it used.
 *
 * Read from the raw log on the server and redacted here: identifying answers are
 * never sent, free text only to roles that may read it. Every view is audited.
 */
export const getSessionDetail = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<SessionDetailResponse> => {
  const actor = await requireStudyActor(request);
  const { study } = actor;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const sessionId = sessionIdArg(data["sessionId"]);
  const now = new Date();

  const sitting = await readSitting(study, sessionId);
  if (!sitting) throw new HttpsError("not-found", "No session with that id exists in this study (it may have been withdrawn).");

  const [release, reviewSnap, notesSnap, metas] = await Promise.all([
    releaseIndex(study, sitting.releaseHash),
    dash().doc(dpaths.review(study, sessionId)).get(),
    dash().collection(dpaths.notes(study, sessionId)).orderBy("createdAt", "asc").limit(500).get(),
    releaseList(study),
  ]);
  const review: ReviewDoc = reviewSnap.exists ? ({ ...emptyReview(sessionId), ...(reviewSnap.data() as Partial<ReviewDoc>) } as ReviewDoc) : emptyReview(sessionId);
  delete (review as unknown as Record<string, unknown>)["_ts"];

  const { summary, assessment } = buildSummary(sitting, release, actor.policy, { now });
  const status = deriveStatus(summary, review, actor.policy, now);
  const studyCodes = can(actor.role, "view.studyCode", actor.policy);
  const freeText = can(actor.role, "view.freeText", actor.policy);
  const row = { summary, review, status, survey: release?.survey ?? null };

  let nav: SessionDetailResponse["neighbours"] = null;
  const context = data["context"] as Record<string, unknown> | undefined;
  if (context && typeof context === "object") {
    const { rows } = await currentRows(study, now);
    const ordered = orderedRows(
      rows,
      { filters: sanitiseFilters(context["filters"]), sort: sanitiseSort(context["sort"]), search: searchArg(context["search"]) },
      { now, timeZone: actor.policy.timeZone },
      { studyCodes },
    );
    nav = neighbours(ordered, sessionId, clampInt(context["pageSize"], 25, 200, 50));
  }

  // Questions the active (or newest) version of the same survey asks that this sitting's version did not.
  const sameSurvey = release ? (await allReleaseIndexes(study)).filter((r) => r.survey === release.survey) : [];
  const newest = sameSurvey.find((r) => r.hash === actor.policy.activeReleaseHash) ?? [...sameSurvey].sort((a, b) => compareVersions(b.version, a.version))[0];
  const newestIndex = newest && newest.hash !== sitting.releaseHash ? newest : null;
  const notInVersion =
    release && newestIndex
      ? newestIndex.questions.filter((q) => !release.byKey.has(q.key)).map((q) => ({ key: q.key, text: q.text, version: newestIndex.version }))
      : [];

  const notes: NoteView[] = notesSnap.docs.map((d) => {
    const n = d.data();
    return { id: d.id, text: String(n["text"] ?? ""), authorUid: String(n["authorUid"] ?? ""), authorEmail: (n["authorEmail"] as string) ?? null, createdAt: iso(n["createdAt"]) };
  });

  const meta = release ? metas.find((m) => m.hash === release.hash) : undefined;
  await audit({ action: "session.viewed", ...actorFields(actor), target: { type: "session", id: sessionId } });

  return {
    item: toListItem(row, { studyCodes, ...(release ? { sectionTitle: (k: string) => release.sections.find((x) => x.key === k)?.title } : {}) }),
    counts: summary.releaseKnown ? summary.counts : null,
    sections: summary.sections,
    estimateReasons: summary.estimateReasons,
    warnings: status.signals,
    resumedCount: summary.resumedCount,
    reviewEdits: summary.reviewEdits,
    backNavigations: summary.backNavigations,
    tooFastCount: summary.tooFastCount,
    eventCount: summary.eventCount,
    deviceId: studyCodes ? summary.deviceId : null,
    release: meta ? releaseView(meta) : release ? { hash: release.hash, key: release.key, version: release.version, publishedAt: release.publishedAt, title: release.title, questionCount: release.questions.length, sectionCount: release.sections.length } : null,
    answers: release ? presentAnswers(assessment, release, { freeText }) : null,
    notInVersion,
    review,
    notes,
    neighbours: nav,
    permissions: { review: can(actor.role, "review.write", actor.policy), freeText, studyCode: studyCodes },
  };
});
