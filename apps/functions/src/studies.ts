import { compareVersions, isStudyId, isSurveyId, studyStatus, type StudyStatus, type StudyView, type SurveyView } from "@myself-dashboard/core";
import { DEFAULT_STUDY, research } from "./env.js";
import { spaths } from "./paths.js";
import { allReleaseIndexes, ReleaseRejected, studioRelease } from "./releases.js";

/**
 * The studies and their surveys, from the survey's database (its docs/16 §11.4
 * and §11.6; the dashboard's docs/12 §12.2). Read with the Admin SDK, never
 * written.
 *
 * A STUDY is registered when its registry document `studies/{study}` exists,
 * or when it is the deployment's default (`ybm`), which needs no document.
 * Anything else — an id off the pattern, or a well-formed id nobody created —
 * is not a study, and nothing is read or written in its name.
 */

export interface RegisteredStudy {
  study: string;
  /** The registry's title; null for the default study with no document. */
  title: string | null;
  status: StudyStatus;
  isDefault: boolean;
}

export type StudyLookup = { kind: "registered"; study: string } | { kind: "malformed" } | { kind: "unknown"; study: string };

const isStudyName = (id: unknown): id is string => typeof id === "string" && (isStudyId(id) || id === DEFAULT_STUDY);

/**
 * Studies known to be registered. A study is never deleted, so once seen it is
 * remembered for the life of the instance; one not found is asked about again
 * next time, so a study created a moment ago is never missed.
 */
const known = new Set<string>([DEFAULT_STUDY]);

/** The study a request or a path names, looked up. `undefined` and `null` are the default. */
export async function lookupStudy(raw: unknown): Promise<StudyLookup> {
  const id = raw === undefined || raw === null ? DEFAULT_STUDY : raw;
  if (!isStudyName(id)) return { kind: "malformed" };
  if (known.has(id)) return { kind: "registered", study: id };
  const snap = await research().doc(spaths.study(id)).get();
  if (!snap.exists) return { kind: "unknown", study: id };
  known.add(id);
  return { kind: "registered", study: id };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

let listCache: { at: number; value: RegisteredStudy[] } | null = null;
const LIST_TTL_MS = 30_000;

/** Every registered study: each registry document, and the default whether or not it has one. The default first. */
export async function registeredStudies(fresh = false): Promise<RegisteredStudy[]> {
  if (!fresh && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.value;
  const snap = await research().collection(spaths.studies()).get();
  const found = new Map<string, RegisteredStudy>();
  for (const doc of snap.docs) {
    // A document under studies/ whose id is not a study id was not written by the Studio.
    if (!isStudyName(doc.id)) continue;
    const d = doc.data();
    found.set(doc.id, { study: doc.id, title: str(d["title"]), status: studyStatus(d["status"]), isDefault: doc.id === DEFAULT_STUDY });
    known.add(doc.id);
  }
  if (!found.has(DEFAULT_STUDY)) found.set(DEFAULT_STUDY, { study: DEFAULT_STUDY, title: null, status: "open", isDefault: true });
  const value = [...found.values()].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.study.localeCompare(b.study)));
  listCache = { at: Date.now(), value };
  return value;
}

// ── A study's surveys ───────────────────────────────────────────────────────

const surveyCache = new Map<string, { at: number; value: SurveyView[] }>();
const SURVEY_TTL_MS = 60_000;
/** Titles of live versions only Studio holds yet, by hash: a manifest never changes. */
const studioTitles = new Map<string, string | null>();

async function studioTitle(study: string, hash: string): Promise<string | null> {
  const key = `${study} ${hash}`;
  if (studioTitles.has(key)) return studioTitles.get(key)!;
  let title: string | null = null;
  try {
    const found = await studioRelease(hash, study);
    title = str((found?.manifest["composition"] as { title?: unknown } | undefined)?.title);
  } catch (error) {
    if (!(error instanceof ReleaseRejected)) throw error;
  }
  studioTitles.set(key, title);
  return title;
}

/**
 * A study's surveys (§11.6): one per live pointer, `published/{surveyId}`, and
 * one per survey a registered version of the study belongs to — so the default
 * study's survey is listed before Studio has ever been set up, and a survey
 * whose sittings are in hand stays listed whatever happens to its pointer.
 * A survey's title is its release's `composition.title`: the live version's
 * where it has one, else its newest registered version's.
 */
export async function studySurveys(study: string, fresh = false): Promise<SurveyView[]> {
  const hit = surveyCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < SURVEY_TTL_MS) return hit.value;
  const [pointers, releases] = await Promise.all([research().collection(spaths.publishedPointers(study)).get(), allReleaseIndexes(study)]);
  const surveys = new Map<string, SurveyView>();
  const add = (surveyId: string) => {
    let s = surveys.get(surveyId);
    if (!s) surveys.set(surveyId, (s = { surveyId, title: surveyId, live: null, releases: [] }));
    return s;
  };
  for (const r of [...releases].sort((a, b) => compareVersions(a.version, b.version))) {
    if (!r.survey || !isSurveyId(r.survey)) continue;
    const s = add(r.survey);
    s.releases.push(r.hash);
    s.title = r.title;
  }
  for (const p of pointers.docs) {
    const hash = str(p.get("hash"));
    const version = str(p.get("version"));
    if (!isSurveyId(p.id) || !hash || !version) continue;
    const s = add(p.id);
    s.live = { version, hash };
    s.title = releases.find((r) => r.hash === hash)?.title ?? (await studioTitle(study, hash)) ?? s.title;
  }
  const value = [...surveys.values()].sort((a, b) => a.title.localeCompare(b.title) || a.surveyId.localeCompare(b.surveyId));
  surveyCache.set(study, { at: Date.now(), value });
  return value;
}

/**
 * How the switcher shows a study. The default study with no document is titled
 * by its live survey (§11.6) — with several, the one it has run longest, the
 * one with the most registered versions (for ybm, ybm_nd2026_standard).
 */
export async function studyView(s: RegisteredStudy): Promise<StudyView> {
  let title = s.title;
  if (!title) {
    const surveys = [...(await studySurveys(s.study))].sort((a, b) => Number(!!b.live) - Number(!!a.live) || b.releases.length - a.releases.length);
    title = surveys[0]?.title ?? s.study;
  }
  return { study: s.study, title, status: s.status, isDefault: s.isDefault };
}

/** Test hook. */
export function resetStudies(): void {
  known.clear();
  known.add(DEFAULT_STUDY);
  listCache = null;
  surveyCache.clear();
  studioTitles.clear();
}
