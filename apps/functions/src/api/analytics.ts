import {
  compareVersions,
  computeAnalytics,
  computeQuestionStats,
  compareReleases,
  makePredicate,
  questionHistory,
  rangeFor,
  sanitiseFilters,
  type AnalyticsResponse,
  type QuestionAnalyticsResponse,
  type QuestionHistoryResponse,
  type ResearcherViewResponse,
} from "@myself-dashboard/core";
import { researcherViewFigures, unknownToStudy } from "@myself-dashboard/core/survey";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireStudyActor } from "../authz.js";
import { dash } from "../env.js";
import { dpaths } from "../paths.js";
import { allReleaseIndexes, releaseIndex, releaseList } from "../releases.js";
import { currentRows } from "../store.js";
import { loadStudyDataset } from "../studyData.js";
import { callableOptions, releaseView, requireString } from "./common.js";

/** Overview, completeness and version analytics for the current filters. */
export const getAnalytics = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<AnalyticsResponse> => {
  const actor = await requireStudyActor(request);
  const filters = sanitiseFilters((request.data as Record<string, unknown> | undefined)?.["filters"]);
  const now = new Date();
  const [{ rows, summaries }, releases, metas, freshSnap] = await Promise.all([
    currentRows(actor.study, now),
    allReleaseIndexes(actor.study),
    releaseList(actor.study),
    dash().doc(dpaths.freshness(actor.study)).get(),
  ]);
  const ctx = { now, timeZone: actor.policy.timeZone };
  const filtered = rows.filter(makePredicate(filters, ctx));
  const analytics = computeAnalytics(filtered, { ...ctx, range: rangeFor(filters, ctx), releases });
  const f = freshSnap.data() ?? {};
  const newest = [...metas].sort((a, b) => compareVersions(b.version, a.version))[0];
  return {
    analytics,
    freshness: {
      lastSummaryAt: f["lastSummaryAt"] instanceof Timestamp ? (f["lastSummaryAt"] as Timestamp).toDate().toISOString() : null,
      summaryCount: summaries.size,
      rulesVersion: typeof f["rulesVersion"] === "string" ? (f["rulesVersion"] as string) : null,
    },
    releases: metas.map(releaseView),
    activeReleaseHash: actor.policy.activeReleaseHash ?? newest?.hash ?? null,
  };
});

/**
 * The survey researcher view's Overview figures, for the same filters: computed by its
 * own counting code over the study as the survey links it, so the two tools can be
 * checked against each other. A separate call from getAnalytics because it reads every
 * raw sitting (cached for a few minutes by loadStudyDataset), and the Overview should
 * not wait for that. Aggregates only, like getAnalytics, so nothing is audited.
 */
export const getResearcherView = onCall({ ...callableOptions, memory: "1GiB", timeoutSeconds: 120 }, async (request): Promise<ResearcherViewResponse> => {
  const actor = await requireStudyActor(request);
  const filters = sanitiseFilters((request.data as Record<string, unknown> | undefined)?.["filters"]);
  const now = new Date();
  const ctx = { now, timeZone: actor.policy.timeZone };
  const [{ study: cached }, { rows }] = await Promise.all([loadStudyDataset(actor.study), currentRows(actor.study, now)]);
  // With a survey chosen, its sittings are counted by the researcher view's own rules; the
  // participants they belong to stay linked across the whole study (docs/12 §12.6).
  const filtered = rows.filter(makePredicate(filters, ctx));
  // A sitting that arrived since the cached study was built would otherwise count as
  // "not linked to a participant"; reading the study again costs less than that error.
  const study = unknownToStudy(cached, filtered) > 0 ? (await loadStudyDataset(actor.study, { fresh: true })).study : cached;
  return researcherViewFigures(study, filtered, now);
});

/** Question-level analysis for ONE version, optionally compared with another. */
export const getQuestionAnalytics = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<QuestionAnalyticsResponse> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const versionHash = requireString(data["versionHash"], "versionHash", 80);
  const release = await releaseIndex(actor.study, versionHash);
  if (!release) throw new HttpsError("not-found", "That survey version is not in this study's registry.");
  const other = typeof data["compareWith"] === "string" ? await releaseIndex(actor.study, data["compareWith"] as string) : null;
  const now = new Date();
  // Question analysis is always for the one version: whatever version filter is
  // set elsewhere, this view reads only sittings collected under `versionHash`.
  const filters = { ...sanitiseFilters(data["filters"]), versions: [versionHash] };
  const { rows } = await currentRows(actor.study, now);
  const filtered = rows.filter(makePredicate(filters, { now, timeZone: actor.policy.timeZone }));
  const metas = await releaseList(actor.study);
  const meta = metas.find((m) => m.hash === versionHash)!;
  return {
    release: releaseView(meta ?? { hash: release.hash, key: release.key, version: release.version, study: release.study, title: release.title, publishedAt: release.publishedAt, questionCount: release.questions.length, sectionCount: release.sections.length }),
    stats: computeQuestionStats(filtered, release, actor.policy.requiredLevels),
    comparison: other ? (compareVersions(other.version, release.version) < 0 ? compareReleases(other, release) : compareReleases(release, other)) : null,
    sessions: filtered.length,
    computedAt: now.toISOString(),
  };
});

/** One stable question across every version: wording, options, conditions. */
export const getQuestionHistory = onCall(callableOptions, async (request): Promise<QuestionHistoryResponse> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const key = requireString(data["key"], "key", 160);
  if (!/^[a-z0-9_.]+$/.test(key)) throw new HttpsError("invalid-argument", "that is not a question id");
  // Within one survey when one is chosen: another survey's question of the same id is another question.
  const surveys = sanitiseFilters(data["filters"]).surveys;
  const releases = (await allReleaseIndexes(actor.study)).filter((r) => surveys.length === 0 || (r.survey !== null && surveys.includes(r.survey)));
  return { key, entries: questionHistory(key, releases) };
});
