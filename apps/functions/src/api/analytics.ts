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
} from "@myself-dashboard/core";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireActor } from "../authz.js";
import { dash } from "../env.js";
import { dpaths } from "../paths.js";
import { allReleaseIndexes, releaseIndex, releaseList } from "../releases.js";
import { currentRows } from "../store.js";
import { callableOptions, releaseView, requireString } from "./common.js";

/** Overview, completeness and version analytics for the current filters. */
export const getAnalytics = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<AnalyticsResponse> => {
  const actor = await requireActor(request);
  const filters = sanitiseFilters((request.data as Record<string, unknown> | undefined)?.["filters"]);
  const now = new Date();
  const [{ rows, summaries }, releases, metas, freshSnap] = await Promise.all([
    currentRows(now),
    allReleaseIndexes(),
    releaseList(),
    dash().doc(dpaths.freshness()).get(),
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

/** Question-level analysis for ONE version, optionally compared with another. */
export const getQuestionAnalytics = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<QuestionAnalyticsResponse> => {
  const actor = await requireActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const versionHash = requireString(data["versionHash"], "versionHash", 80);
  const release = await releaseIndex(versionHash);
  if (!release) throw new HttpsError("not-found", "That survey version is not in the registry.");
  const other = typeof data["compareWith"] === "string" ? await releaseIndex(data["compareWith"] as string) : null;
  const now = new Date();
  // Question analysis is always for the one version: whatever version filter is
  // set elsewhere, this view reads only sittings collected under `versionHash`.
  const filters = { ...sanitiseFilters(data["filters"]), versions: [versionHash] };
  const { rows } = await currentRows(now);
  const filtered = rows.filter(makePredicate(filters, { now, timeZone: actor.policy.timeZone }));
  const metas = await releaseList();
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
  await requireActor(request);
  const key = requireString((request.data as Record<string, unknown> | undefined)?.["key"], "key", 160);
  if (!/^[a-z0-9_.]+$/.test(key)) throw new HttpsError("invalid-argument", "that is not a question id");
  const releases = await allReleaseIndexes();
  return { key, entries: questionHistory(key, releases) };
});
