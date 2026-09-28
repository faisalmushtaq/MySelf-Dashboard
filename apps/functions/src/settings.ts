import { readPolicy, type Policy } from "@myself-dashboard/core";
import { dash } from "./env.js";
import { dpaths } from "./paths.js";

/**
 * The access policy (who may use the dashboard) and the study policy (what the
 * numbers mean), cached briefly per instance. Thirty seconds is the longest a
 * removed email keeps working on a warm instance — and it also has to hold a role,
 * which the same change removes.
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
let policyCache: { at: number; value: Policy } | null = null;

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

export async function studyPolicy(fresh = false): Promise<Policy> {
  if (!fresh && policyCache && Date.now() - policyCache.at < TTL_MS) return policyCache.value;
  const snap = await dash().doc(dpaths.policyConfig()).get();
  const value = readPolicy(snap.exists ? snap.data() : {});
  policyCache = { at: Date.now(), value };
  return value;
}

/** For tests and for the admin callables that just changed a setting. */
export function invalidateSettings(): void {
  accessCache = null;
  policyCache = null;
}
