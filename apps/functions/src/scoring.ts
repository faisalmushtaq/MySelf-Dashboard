import { checkScheme, compareVersions, DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES, groupSettings, parseScheme, type GroupSettings, type ReleaseIndex, type ScoringScheme, type ScoresView } from "@myself-dashboard/core";
import { scoreStudy, type ScoredSession } from "@myself-dashboard/core/survey";
import { dash } from "./env.js";
import { dpaths } from "./paths.js";
import { allReleaseIndexes } from "./releases.js";
import { loadStudyDataset, resetStudyDataset } from "./studyData.js";

/**
 * The study's scoring: the dashboard's default schemes, replaced by any
 * version the study has saved (studies/{study}/scoringSchemes/{key}, with
 * every saved version kept under …/versions), and the school and year-group
 * settings (config/groups). Only the server reads or writes these; the web app
 * sees them through audited calls.
 */

export interface StoredScheme {
  scheme: ScoringScheme;
  savedAt: string | null;
  savedBy: string | null;
  reason: string | null;
}

let schemeCache: { at: number; value: Map<string, StoredScheme> } | null = null;
let groupCache: { at: number; value: GroupSettings } | null = null;
let scoredCache: { key: string; at: number; value: ScoredSession[] } | null = null;
const TTL_MS = 60_000;

const iso = (v: unknown) => (v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate: () => Date }).toDate().toISOString() : typeof v === "string" ? v : null);

/** The study's saved schemes, by key (a saved scheme that no longer parses is skipped and reported by the settings view). */
export async function savedSchemes(fresh = false): Promise<Map<string, StoredScheme>> {
  if (!fresh && schemeCache && Date.now() - schemeCache.at < TTL_MS) return schemeCache.value;
  const snap = await dash().collection(dpaths.scoringSchemes()).get();
  const value = new Map<string, StoredScheme>();
  for (const d of snap.docs) {
    const x = d.data();
    const parsed = typeof x["schemeJson"] === "string" ? parseScheme(JSON.parse(x["schemeJson"] as string)) : { errors: ["no scheme stored"] };
    if ("scheme" in parsed) value.set(d.id, { scheme: parsed.scheme, savedAt: iso(x["savedAt"]), savedBy: (x["savedBy"] as string) ?? null, reason: (x["reason"] as string) ?? null });
  }
  schemeCache = { at: Date.now(), value };
  return value;
}

/** Defaults, with the study's saved versions in their place, then any schemes the study added. */
export async function effectiveSchemes(fresh = false): Promise<ScoringScheme[]> {
  const saved = await savedSchemes(fresh);
  const out = DEFAULT_SCHEMES.map((d) => saved.get(d.key)?.scheme ?? d);
  for (const [key, s] of saved) if (!DEFAULT_SCHEMES.some((d) => d.key === key)) out.push(s.scheme);
  return out;
}

export async function studyGroupSettings(fresh = false): Promise<GroupSettings> {
  if (!fresh && groupCache && Date.now() - groupCache.at < TTL_MS) return groupCache.value;
  const snap = await dash().doc(dpaths.groupsConfig()).get();
  const parsed = groupSettings.safeParse(snap.exists ? snap.data() : {});
  const value = parsed.success ? parsed.data : DEFAULT_GROUP_SETTINGS;
  groupCache = { at: Date.now(), value };
  return value;
}

export function invalidateScoring(options: { dataset?: boolean } = {}): void {
  schemeCache = null;
  groupCache = null;
  scoredCache = null;
  if (options.dataset) resetStudyDataset();
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
export async function scoredSessions(options: { schemes?: ScoringScheme[]; fresh?: boolean } = {}): Promise<{ sessions: ScoredSession[]; schemes: ScoringScheme[]; settings: GroupSettings; releases: ReleaseIndex[] }> {
  const [settings, releases] = await Promise.all([studyGroupSettings(options.fresh), allReleaseIndexes()]);
  const schemes = options.schemes ?? (await effectiveSchemes(options.fresh));
  const { study } = await loadStudyDataset({ fresh: options.fresh === true, schoolYearStartMonth: settings.yearGroup.startMonth });
  const key = JSON.stringify([schemes.map((s) => `${s.key}@${s.version}`), settings, study.dataset.generatedAt, study.dataset.sessions.length]);
  if (!options.schemes && scoredCache && scoredCache.key === key && Date.now() - scoredCache.at < TTL_MS) return { sessions: scoredCache.value, schemes, settings, releases };
  const sessions = scoreStudy(study, { schemes, releases: new Map(releases.map((r) => [r.hash, r])), groups: settings });
  if (!options.schemes) scoredCache = { key, at: Date.now(), value: sessions };
  return { sessions, schemes, settings, releases };
}
