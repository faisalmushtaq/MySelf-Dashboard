import { readAccessList, readPolicy, type Policy, type StudyAccessList } from "@myself-dashboard/core";
import { dash, DEFAULT_STUDY } from "./env.js";
import { dpaths } from "./paths.js";

/**
 * The access policy (who may use the dashboard), each study's own access list
 * (who else may see it) and each study's policy (what the numbers mean), cached
 * briefly per instance. Thirty seconds is the longest a removed email keeps
 * working on a warm instance — and it also has to hold a role, which the same
 * change removes.
 */

export interface AccessPolicy {
  emails: string[];
  domains: string[];
}

/**
 * Seeded by scripts/bootstrap-admin.mjs. Until then the dashboard admits nobody:
 * an access policy that is missing is an empty one, never an open one.
 */
export const EMPTY_ACCESS: AccessPolicy = { emails: [], domains: [] };

const TTL_MS = 30_000;
let accessCache: { at: number; value: AccessPolicy } | null = null;
const policyCache = new Map<string, { at: number; value: Policy }>();
const studyAccessCache = new Map<string, { at: number; value: StudyAccessList | null }>();

export function parseAccess(raw: unknown): AccessPolicy {
  const r = (raw ?? {}) as { emails?: unknown; domains?: unknown };
  const strings = (x: unknown) =>
    Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toLowerCase()) : [];
  return { emails: strings(r.emails), domains: strings(r.domains).map((d) => d.replace(/^@/, "")) };
}

export async function accessPolicy(fresh = false): Promise<AccessPolicy> {
  if (!fresh && accessCache && Date.now() - accessCache.at < TTL_MS) return accessCache.value;
  const snap = await dash().doc(dpaths.accessConfig()).get();
  const value = snap.exists ? parseAccess(snap.data()) : EMPTY_ACCESS;
  accessCache = { at: Date.now(), value };
  return value;
}

/**
 * Who else may see `study` (docs/12 §12.4): null for the default study, whose
 * list is the dashboard's own, and for a study nobody has been added to yet —
 * which only administrators then see.
 */
export async function studyAccessList(study: string, fresh = false): Promise<StudyAccessList | null> {
  if (study === DEFAULT_STUDY) return null;
  const hit = studyAccessCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const snap = await dash().doc(dpaths.studyAccess(study)).get();
  const value = snap.exists ? readAccessList(snap.data()) : null;
  studyAccessCache.set(study, { at: Date.now(), value });
  return value;
}

/**
 * A study's policy. The default study's is `config/policy`, where it always
 * was. Another study's is its own once an administrator has saved one while in
 * it; until then it is the default study's, with no active version of its own,
 * because a version of one study is never another's (docs/12 §12.3).
 */
export async function studyPolicy(study = DEFAULT_STUDY, fresh = false): Promise<Policy> {
  const hit = policyCache.get(study);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: Policy;
  const snap = await dash().doc(dpaths.policyConfig(study)).get();
  if (snap.exists || study === DEFAULT_STUDY) value = readPolicy(snap.exists ? snap.data() : {});
  else value = { ...(await studyPolicy(DEFAULT_STUDY, fresh)), activeReleaseHash: null };
  policyCache.set(study, { at: Date.now(), value });
  return value;
}

/** For tests and for the admin callables that just changed a setting. */
export function invalidateSettings(): void {
  accessCache = null;
  policyCache.clear();
  studyAccessCache.clear();
}
