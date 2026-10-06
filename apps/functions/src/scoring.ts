import { checkScheme, compareVersions, DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES, groupSettings, parseScheme, type GroupSettings, type ReleaseIndex, type ScoringScheme, type ScoresView } from "@myself-dashboard/core";
import { scoreStudy, type ScoredSession } from "@myself-dashboard/core/survey";
import { dash, DEFAULT_STUDY } from "./env.js";
import { dpaths } from "./paths.js";
import { allReleaseIndexes } from "./releases.js";
import { loadStudyDataset, resetStudyDataset } from "./studyData.js";

/**
 * A study's scoring: the dashboard's default schemes, replaced by any
 * version the study has saved (studies/{study}/scoringSchemes/{key}, with
 * every saved version kept under …/versions), and the school and year-group
 * settings (config/groups for the default study; another study's own once an
 * administrator saves some in it, the default study's until then — docs/12
 * §12.3). Only the server reads or writes these; the web app sees them through
 * audited calls.
 */

export interface StoredScheme {
  scheme: ScoringScheme;
  savedAt: string | null;
  savedBy: string | null;
  reason: string | null;
}

const schemeCache = new Map<string, { at: number; value: Map<string, StoredScheme> }>();
const groupCache = new Map<string, { at: number; value: GroupSettings }>();
const scoredCache = new Map<string, { key: string; at: number; value: ScoredSession[] }>();
const TTL_MS = 60_000;

const iso = (v: unknown) => (v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate: () => Date }).toDate().toISOString() : typeof v === "string" ? v : null);

/** The study's saved schemes, by key (a saved scheme that no longer parses is skipped and reported by the settings view). */
export async function savedSchemes(study: string, fresh = false): Promise<Map<string, StoredScheme>> {
  const hit = schemeCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const snap = await dash().collection(dpaths.scoringSchemes(study)).get();
  const value = new Map<string, StoredScheme>();
  for (const d of snap.docs) {
    const x = d.data();
    const parsed = typeof x["schemeJson"] === "string" ? parseScheme(JSON.parse(x["schemeJson"] as string)) : { errors: ["no scheme stored"] };
    if ("scheme" in parsed) value.set(d.id, { scheme: parsed.scheme, savedAt: iso(x["savedAt"]), savedBy: (x["savedBy"] as string) ?? null, reason: (x["reason"] as string) ?? null });
  }
  schemeCache.set(study, { at: Date.now(), value });
  return value;
}

/** Defaults, with the study's saved versions in their place, then any schemes the study added. */
export async function effectiveSchemes(study: string, fresh = false): Promise<ScoringScheme[]> {
  const saved = await savedSchemes(study, fresh);
  const out = DEFAULT_SCHEMES.map((d) => saved.get(d.key)?.scheme ?? d);
  for (const [key, s] of saved) if (!DEFAULT_SCHEMES.some((d) => d.key === key)) out.push(s.scheme);
  return out;
}

export async function studyGroupSettings(study: string, fresh = false): Promise<GroupSettings> {
  const hit = groupCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const snap = await dash().doc(dpaths.groupsConfig(study)).get();
  let value: GroupSettings;
  if (!snap.exists && study !== DEFAULT_STUDY) value = await studyGroupSettings(DEFAULT_STUDY, fresh);
  else {
    const parsed = groupSettings.safeParse(snap.exists ? snap.data() : {});
    value = parsed.success ? parsed.data : DEFAULT_GROUP_SETTINGS;
  }
  groupCache.set(study, { at: Date.now(), value });
  return value;
}

export function invalidateScoring(options: { dataset?: boolean; study?: string } = {}): void {
  schemeCache.clear();
  groupCache.clear();
  scoredCache.clear();
  if (options.dataset) resetStudyDataset(options.study);
}

/** Each scheme checked against every survey version that administers its instrument. */
export function schemeChecks(schemes: readonly ScoringScheme[], releases: readonly ReleaseIndex[]): ScoresView["checks"] {
  const ordered = [...releases].sort((a, b) => compareVersions(a.version, b.version));
  return Object.fromEntries(
    schemes.map((s) => [
      s.key,
      ordered.flatMap((r) => {
        const c = checkScheme(s, r);
        return c.applies ? [{ version: r.version, issues: c.issues }] : [];
      }),
    ]),
  );
}

/**
 * Every linked sitting scored with `schemes` (the study's, unless a draft is
 * being previewed), cached briefly for the study's own schemes.
 */
export async function scoredSessions(
  study: string,
  options: { schemes?: ScoringScheme[]; fresh?: boolean } = {},
): Promise<{ sessions: ScoredSession[]; schemes: ScoringScheme[]; settings: GroupSettings; releases: ReleaseIndex[] }> {
  const [settings, releases] = await Promise.all([studyGroupSettings(study, options.fresh), allReleaseIndexes(study)]);
  const schemes = options.schemes ?? (await effectiveSchemes(study, options.fresh));
  const { study: data } = await loadStudyDataset(study, { fresh: options.fresh === true, schoolYearStartMonth: settings.yearGroup.startMonth });
  const key = JSON.stringify([schemes.map((s) => `${s.key}@${s.version}`), settings, data.dataset.generatedAt, data.dataset.sessions.length]);
  const hit = scoredCache.get(study);
  if (!options.schemes && hit && hit.key === key && Date.now() - hit.at < TTL_MS) return { sessions: hit.value, schemes, settings, releases };
  const sessions = scoreStudy(data, { schemes, releases: new Map(releases.map((r) => [r.hash, r])), groups: settings });
  if (!options.schemes) scoredCache.set(study, { key, at: Date.now(), value: sessions });
  return { sessions, schemes, settings, releases };
}
