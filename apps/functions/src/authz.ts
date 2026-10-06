import { can, decideStudyAccess, emailAllowed, isRole, ROLE_LABELS, type Capability, type Policy, type Role } from "@myself-dashboard/core";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { audit } from "./audit.js";
import { auth, DEFAULT_STUDY } from "./env.js";
import { accessPolicy, studyAccessList, studyPolicy, type AccessPolicy } from "./settings.js";
import { lookupStudy } from "./studies.js";

/**
 * Who is calling, and may they?
 *
 * Every callable goes through `requireActor`. A request is authorised only when
 * ALL of these hold (docs/02 §2.2):
 *
 *   1. it carries a verified Firebase ID token (the callable framework checks it);
 *   2. the account signed in with Google, and its email is verified;
 *   3. it is not a survey device (they carry `device: true` or sign in anonymously);
 *   4. its email is allowed by the access policy (allowlist or Workspace domain);
 *   5. it holds a dashboard role — read from the account's CURRENT custom claims,
 *      not from the token, so removing a role takes effect within a minute rather
 *      than when the hour-long token expires;
 *   6. the account is not disabled.
 *
 * The decision itself is `decideAccess`, a pure function, so every refusal is
 * unit-tested without an emulator.
 *
 * Everything a study holds also goes through `requireStudyActor`, which then
 * decides the study (docs/12 §12.4).
 */

export interface Actor {
  uid: string;
  email: string;
  role: Role;
  policy: Policy;
}

export interface TokenFacts {
  uid: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  provider?: string | undefined;
  device?: boolean | undefined;
}

export interface AccountFacts {
  disabled: boolean;
  claims: Record<string, unknown>;
}

export type AccessDecision =
  | { ok: true; role: Role; email: string }
  | { ok: false; code: "unauthenticated" | "permission-denied"; reason: string; audit: string };

export function decideAccess(token: TokenFacts | null, account: AccountFacts | null, access: AccessPolicy): AccessDecision {
  if (!token) return { ok: false, code: "unauthenticated", reason: "Sign in with your Google account first.", audit: "no_token" };
  if (token.device || token.provider === "anonymous" || account?.claims["device"] === true) {
    return { ok: false, code: "permission-denied", reason: "Survey devices cannot use the research dashboard.", audit: "device" };
  }
  if (token.provider !== "google.com") {
    return { ok: false, code: "permission-denied", reason: "Sign in with Google to use the research dashboard.", audit: "provider" };
  }
  if (!token.email || token.emailVerified !== true) {
    return { ok: false, code: "permission-denied", reason: "This Google account's email address is not verified.", audit: "email_unverified" };
  }
  if (!account || account.disabled) {
    return { ok: false, code: "permission-denied", reason: "This account has been disabled.", audit: "disabled" };
  }
  if (!emailAllowed(token.email, access)) {
    return {
      ok: false,
      code: "permission-denied",
      reason: `${token.email} is not an approved BrainPOP Research account. Ask a dashboard administrator for access.`,
      audit: "not_allowlisted",
    };
  }
  const role = account.claims["role"];
  if (!isRole(role)) {
    return {
      ok: false,
      code: "permission-denied",
      reason: `${token.email} is approved but has not been given a dashboard role yet. Ask a dashboard administrator.`,
      audit: "no_role",
    };
  }
  return { ok: true, role, email: token.email.toLowerCase() };
}

const accountCache = new Map<string, { at: number; value: AccountFacts | null }>();
const ACCOUNT_TTL_MS = 60_000;

export async function accountFacts(uid: string): Promise<AccountFacts | null> {
  const hit = accountCache.get(uid);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.value;
  let value: AccountFacts | null = null;
  try {
    const user = await auth().getUser(uid);
    value = { disabled: user.disabled, claims: (user.customClaims ?? {}) as Record<string, unknown> };
  } catch {
    value = null;
  }
  accountCache.set(uid, { at: Date.now(), value });
  return value;
}

export function forgetAccount(uid: string): void {
  accountCache.delete(uid);
}

export function tokenFacts(token: Record<string, unknown> | undefined, uid: string | undefined): TokenFacts | null {
  if (!token || !uid) return null;
  const firebase = token["firebase"] as { sign_in_provider?: string } | undefined;
  return {
    uid,
    email: typeof token["email"] === "string" ? (token["email"] as string) : undefined,
    emailVerified: token["email_verified"] === true,
    provider: firebase?.sign_in_provider,
    device: token["device"] === true,
  };
}

export async function evaluate(request: Pick<CallableRequest, "auth">): Promise<{ decision: AccessDecision; token: TokenFacts | null }> {
  const token = tokenFacts(request.auth?.token as Record<string, unknown> | undefined, request.auth?.uid);
  const [account, access] = await Promise.all([token ? accountFacts(token.uid) : Promise.resolve(null), accessPolicy()]);
  return { decision: decideAccess(token, account, access), token };
}

/**
 * The authorised caller, or an HttpsError the client can show as it is. For
 * what concerns the dashboard as a whole (its access list, roles); `policy` is
 * the default study's.
 */
export async function requireActor(request: Pick<CallableRequest, "auth">, capability: Capability = "view.dashboard"): Promise<Actor> {
  const { decision } = await evaluate(request);
  if (!decision.ok) throw new HttpsError(decision.code, decision.reason);
  const policy = await studyPolicy(DEFAULT_STUDY);
  if (!can(decision.role, capability, policy)) {
    throw new HttpsError("permission-denied", `${ROLE_LABELS[decision.role]}s cannot do this (${capability}).`);
  }
  return { uid: request.auth!.uid, email: decision.email, role: decision.role, policy };
}

/** Someone working in a study they may see, with that study's policy. */
export interface StudyActor extends Actor {
  study: string;
}

/** Refusals of a study, throttled per person and study so a page left open cannot flood the log. */
const studyDeniedRecently = new Map<string, number>();

/**
 * The authorised caller in the study the request names (absent: the default,
 * as every request meant until there were several), or an HttpsError.
 *
 * In this order, before anything of the study is read: the caller may use the
 * dashboard at all (`requireActor`'s checks); the study is a study id and a
 * registered study; the caller may see it (`decideStudyAccess`: administrators
 * every study, everyone the default one, anyone else a study whose own list
 * names them); their role may do this under the study's policy. Every path the
 * handler builds is then built from `actor.study`, never from the request.
 */
export async function requireStudyActor(request: Pick<CallableRequest, "auth" | "data">, capability: Capability = "view.dashboard"): Promise<StudyActor> {
  const { decision } = await evaluate(request);
  if (!decision.ok) throw new HttpsError(decision.code, decision.reason);
  const raw = (request.data as Record<string, unknown> | null | undefined)?.["study"];
  const found = await lookupStudy(raw);
  if (found.kind === "malformed") throw new HttpsError("invalid-argument", "study must be a study id, such as ybm");
  if (found.kind === "unknown") throw new HttpsError("not-found", `There is no study “${found.study}” in this project.`);
  const study = found.study;
  const uid = request.auth!.uid;
  const list = await studyAccessList(study);
  if (!decideStudyAccess({ role: decision.role, email: decision.email, study, defaultStudy: DEFAULT_STUDY, list })) {
    const key = `${uid} ${study}`;
    if (Date.now() - (studyDeniedRecently.get(key) ?? 0) > 10 * 60_000) {
      studyDeniedRecently.set(key, Date.now());
      await audit({ action: "auth.denied", actorUid: uid, actorEmail: decision.email, actorRole: decision.role, target: { type: "study", id: study }, detail: { reason: "study_not_permitted" }, outcome: "denied" });
    }
    throw new HttpsError("permission-denied", `${decision.email} has not been given access to the study “${study}”. Ask a dashboard administrator.`);
  }
  const policy = await studyPolicy(study);
  if (!can(decision.role, capability, policy)) {
    throw new HttpsError("permission-denied", `${ROLE_LABELS[decision.role]}s cannot do this (${capability}).`);
  }
  return { uid, email: decision.email, role: decision.role, policy, study };
}
