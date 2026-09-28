import { can, emailAllowed, isRole, ROLE_LABELS, type Capability, type Policy, type Role } from "@myself-dashboard/core";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { auth } from "./env.js";
import { accessPolicy, studyPolicy, type AccessPolicy } from "./settings.js";

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

/** The authorised caller, or an HttpsError the client can show as it is. */
export async function requireActor(request: Pick<CallableRequest, "auth">, capability: Capability = "view.dashboard"): Promise<Actor> {
  const { decision } = await evaluate(request);
  if (!decision.ok) throw new HttpsError(decision.code, decision.reason);
  const policy = await studyPolicy();
  if (!can(decision.role, capability, policy)) {
    throw new HttpsError("permission-denied", `${ROLE_LABELS[decision.role]}s cannot do this (${capability}).`);
  }
  return { uid: request.auth!.uid, email: decision.email, role: decision.role, policy };
}
