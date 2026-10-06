import {
  buildScoresView,
  can,
  compareVersions,
  DEFAULT_SCHEMES,
  groupSettings,
  makePredicate,
  OBSERVATIONS,
  parseScheme,
  sanitiseFilters,
  SCORE_GROUP_BYS,
  type Observation,
  type SaveSchemeRequest,
  type ScoreFocus,
  type ScoreGroupBy,
  type ScoresView,
  type ScoringScheme,
  type ScoringSettingsView,
  type YearGroupSource,
} from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit, auditIn } from "../audit.js";
import { requireStudyActor } from "../authz.js";
import { dash } from "../env.js";
import { dpaths } from "../paths.js";
import { effectiveSchemes, invalidateScoring, savedSchemes, schemeChecks, scoredSessions, studyGroupSettings } from "../scoring.js";
import { currentRows } from "../store.js";
import { callableOptions } from "./common.js";

/**
 * Scores: every instrument scored with the study's schemes, summarised
 * overall, by school, year group, gender or wave, and for one school or year
 * group against its peers and the benchmarks. Aggregates only.
 */

function focusArg(raw: unknown): ScoreFocus | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const school = typeof f["school"] === "string" && /^[A-Z]{2,12}$/.test(f["school"]) ? f["school"] : null;
  const yearGroup = typeof f["yearGroup"] === "number" && Number.isInteger(f["yearGroup"]) && f["yearGroup"] >= 1 && f["yearGroup"] <= 13 ? f["yearGroup"] : null;
  return school || yearGroup !== null ? { school, yearGroup } : null;
}

const pickOne = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

export const getScores = onCall({ ...callableOptions, memory: "2GiB", timeoutSeconds: 300 }, async (request): Promise<ScoresView> => {
  const actor = await requireStudyActor(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const filters = sanitiseFilters(data["filters"]);
  const observation = pickOne<Observation>(data["observation"], OBSERVATIONS, "latest");
  const groupBy = pickOne<ScoreGroupBy>(data["groupBy"], SCORE_GROUP_BYS, "school");
  const focus = focusArg(data["focus"]);

  let draft: ScoringScheme | null = null;
  if (data["draft"] !== undefined) {
    if (!can(actor.role, "settings.policy", actor.policy)) throw new HttpsError("permission-denied", "Only administrators can preview scoring changes.");
    const parsed = parseScheme(data["draft"]);
    if ("errors" in parsed) throw new HttpsError("invalid-argument", parsed.errors.slice(0, 8).join("\n"));
    draft = parsed.scheme;
  }

  const now = new Date();
  const [{ sessions, schemes, settings, releases }, { rows }] = await Promise.all([scoredSessions(actor.study, draft ? { schemes: [draft] } : {}), currentRows(actor.study, now)]);
  const allowed = new Set(rows.filter(makePredicate(filters, { now, timeZone: actor.policy.timeZone })).map((r) => r.summary.sessionId));
  return buildScoresView(
    sessions.filter((s) => allowed.has(s.sessionId)),
    { schemes, settings, observation, groupBy, focus, checks: schemeChecks(schemes, releases), now },
  );
});

export const getScoringSettings = onCall({ ...callableOptions, memory: "1GiB" }, async (request): Promise<ScoringSettingsView> => {
  const actor = await requireStudyActor(request);
  const [saved, schemes, { sessions, settings, releases }] = await Promise.all([savedSchemes(actor.study, true), effectiveSchemes(actor.study, true), scoredSessions(actor.study, { fresh: true })]);
  const checks = schemeChecks(schemes, releases);
  const histories = await Promise.all(
    schemes.map(async (s) => {
      if (!saved.has(s.key)) return [];
      const snap = await dash().collection(dpaths.scoringSchemeVersions(actor.study, s.key)).get();
      return snap.docs
        .map((d) => {
          const x = d.data();
          let verified = false;
          try {
            verified = !!(JSON.parse(String(x["schemeJson"])) as { verified?: unknown }).verified;
          } catch {
            verified = false;
          }
          const at = x["savedAt"] as { toDate?: () => Date } | undefined;
          return { version: d.id, savedAt: at?.toDate ? at.toDate().toISOString() : null, savedBy: (x["savedBy"] as string) ?? null, reason: (x["reason"] as string) ?? null, verified };
        })
        .sort((a, b) => compareVersions(b.version, a.version));
    }),
  );
  const sources: Record<YearGroupSource | "unknown", number> = { studyCode: 0, item: 0, dob: 0, unknown: 0 };
  const schools = new Map<string, number>();
  for (const s of sessions) {
    sources[s.yearGroupSource ?? "unknown"] += 1;
    if (s.school) schools.set(s.school, (schools.get(s.school) ?? 0) + 1);
  }
  return {
    schemes: schemes.map((scheme, i) => {
      const def = DEFAULT_SCHEMES.find((d) => d.key === scheme.key) ?? null;
      const stored = saved.get(scheme.key);
      const strip = (s: ScoringScheme) => JSON.stringify({ ...s, version: "", verified: null });
      return {
        scheme,
        source: stored ? "study" : "default",
        defaultVersion: def?.version ?? null,
        differsFromDefault: def ? strip(def) !== strip(scheme) : true,
        savedAt: stored?.savedAt ?? null,
        savedBy: stored?.savedBy ?? null,
        reason: stored?.reason ?? null,
        history: histories[i]!,
        checks: checks[scheme.key] ?? [],
        sittings: sessions.filter((x) => x.scores[scheme.key]).length,
      };
    }),
    defaults: [...DEFAULT_SCHEMES],
    groups: settings,
    groupStats: { sittings: sessions.length, yearGroupSources: sources, schools: [...schools.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => ({ key, n })) },
    canEdit: can(actor.role, "settings.policy", actor.policy),
  };
});

const reasonArg = (raw: unknown) => {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < 3 || reason.length > 500) throw new HttpsError("invalid-argument", "Say briefly why (3–500 characters): it is kept with the version.");
  return reason;
};

/** Save a new version of a scheme. Every version is kept; nothing is overwritten. */
export const saveScoringScheme = onCall(callableOptions, async (request): Promise<{ key: string; version: string }> => {
  const actor = await requireStudyActor(request, "settings.policy");
  const data = (request.data ?? {}) as Partial<SaveSchemeRequest>;
  const reason = reasonArg(data.reason);
  const parsed = parseScheme(data.scheme);
  if ("errors" in parsed) throw new HttpsError("invalid-argument", parsed.errors.slice(0, 8).join("\n"));
  const next = parsed.scheme;
  const current = (await effectiveSchemes(actor.study, true)).find((s) => s.key === next.key) ?? null;
  if (current && compareVersions(next.version, current.version) <= 0) {
    throw new HttpsError("failed-precondition", `Version ${next.version} is not newer than the current ${current.version}. Give the change a higher version.`);
  }
  const content = (s: ScoringScheme) => JSON.stringify({ ...s, version: "", verified: null });
  const changed = !current || content(current) !== content(next);
  const verifyNote = typeof data.verifyNote === "string" ? data.verifyNote.trim().slice(0, 600) : "";
  const verified = data.markVerified
    ? { by: actor.email, at: new Date().toISOString(), ...(verifyNote ? { note: verifyNote } : {}) }
    : changed
      ? null
      : (current?.verified ?? null);
  const scheme: ScoringScheme = { ...next, verified };
  const doc = { schemeJson: JSON.stringify(scheme), version: scheme.version, savedAt: FieldValue.serverTimestamp(), savedBy: actor.email, reason };
  const db = dash();
  await db.runTransaction(async (tx) => {
    const versionRef = db.doc(`${dpaths.scoringSchemeVersions(actor.study, scheme.key)}/${scheme.version}`);
    if ((await tx.get(versionRef)).exists) throw new HttpsError("already-exists", `Version ${scheme.version} of ${scheme.key} already exists.`);
    tx.create(versionRef, doc);
    tx.set(db.doc(dpaths.scoringScheme(actor.study, scheme.key)), doc);
    auditIn(tx, {
      action: "scoring.changed",
      ...actorFields(actor),
      target: { type: "scoring_scheme", id: scheme.key },
      detail: { from: current?.version ?? null, to: scheme.version, reason, changed, verified: !!verified },
    });
  });
  invalidateScoring();
  return { key: scheme.key, version: scheme.version };
});

export const saveGroupSettings = onCall(callableOptions, async (request): Promise<{ ok: true }> => {
  const actor = await requireStudyActor(request, "settings.policy");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const reason = reasonArg(data["reason"]);
  const parsed = groupSettings.safeParse(data["settings"]);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
  const before = await studyGroupSettings(actor.study, true);
  await dash().doc(dpaths.groupsConfig(actor.study)).set({ ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email });
  await audit({
    action: "groups.changed",
    ...actorFields(actor),
    target: { type: "config", id: "groups" },
    detail: {
      reason,
      schoolsNamed: Object.keys(parsed.data.schools).length,
      yearGroupOrder: parsed.data.yearGroup.order,
      rules: parsed.data.yearGroup.rules.length,
      startMonth: parsed.data.yearGroup.startMonth,
      minCell: { before: before.minCell, after: parsed.data.minCell },
    },
  });
  invalidateScoring({ dataset: before.yearGroup.startMonth !== parsed.data.yearGroup.startMonth, study: actor.study });
  return { ok: true };
});
