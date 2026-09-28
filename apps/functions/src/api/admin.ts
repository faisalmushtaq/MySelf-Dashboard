import {
  can,
  emailAllowed,
  isRole,
  policySchema,
  ROLES,
  type PersonView,
  type Role,
  type SettingsResponse,
} from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { forgetAccount, requireActor } from "../authz.js";
import { auth, dash, STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { registerRelease, releaseList, ReleaseRejected } from "../releases.js";
import { accessPolicy, invalidateSettings, parseAccess, studyPolicy } from "../settings.js";
import { rebuildAll } from "../summaries.js";
import { resetStore } from "../store.js";
import { callableOptions, releaseView, requireString } from "./common.js";

/**
 * Administration: who may use the dashboard and what the numbers mean. Every
 * callable here requires the Administrator role, is audited, and refuses the
 * changes that would lock the study out of its own administration.
 */

async function people(access: { emails: string[]; domains: string[] }): Promise<PersonView[]> {
  const out: PersonView[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      // Survey devices sign in anonymously or carry a device claim: not people.
      if (claims["device"] === true || !u.email) continue;
      const role = isRole(claims["role"]) ? claims["role"] : null;
      out.push({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName ?? null,
        role,
        allowed: emailAllowed(u.email, access),
        disabled: u.disabled,
        lastSignIn: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return out.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

export const getSettings = onCall(callableOptions, async (request): Promise<SettingsResponse> => {
  await requireActor(request, "settings.access");
  const [access, policy, metas] = await Promise.all([accessPolicy(true), studyPolicy(true), releaseList(true)]);
  return { access, policy, people: await people(access), releases: metas.map(releaseView) };
});

export const updateAccessPolicy = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "settings.access");
  const next = parseAccess(request.data);
  for (const e of next.emails) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpsError("invalid-argument", `${e} is not an email address`);
  for (const d of next.domains) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new HttpsError("invalid-argument", `${d} is not a domain`);
  if (next.emails.length + next.domains.length > 500) throw new HttpsError("invalid-argument", "that list is too long");
  if (!emailAllowed(actor.email, next)) {
    throw new HttpsError("failed-precondition", "That change would remove your own access. Ask another administrator to make it.");
  }
  const before = await accessPolicy(true);
  await dash().doc(dpaths.accessConfig()).set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  invalidateSettings();
  await audit({ action: "access_policy.changed", ...actorFields(actor), detail: { before, after: next } });
  return next;
});

export const updatePolicy = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "settings.policy");
  const parsed = policySchema.safeParse(request.data);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new HttpsError("invalid-argument", `invalid setting: ${i?.path.join(".") ?? ""} ${i?.message ?? ""}`.trim());
  }
  for (const p of parsed.data.testCodePatterns) {
    try {
      new RegExp(p, "i");
    } catch {
      throw new HttpsError("invalid-argument", `'${p}' is not a valid pattern`);
    }
  }
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: parsed.data.timeZone });
  } catch {
    throw new HttpsError("invalid-argument", `'${parsed.data.timeZone}' is not a time zone`);
  }
  const before = await studyPolicy(true);
  await dash().doc(dpaths.policyConfig()).set({ ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  invalidateSettings();
  resetStore();
  await audit({ action: "policy.changed", ...actorFields(actor), detail: { before, after: parsed.data } });
  const requiredChanged = before.requiredLevels.join() !== parsed.data.requiredLevels.join();
  return { policy: parsed.data, rebuildRecommended: requiredChanged };
});

/**
 * Grant, change or remove someone's dashboard role.
 *
 * Refuses an email the access policy does not allow (the dashboard's answer to the
 * survey's setRole having no allowlist), refuses to demote yourself, preserves any
 * other claims the account carries, and revokes refresh tokens so the change
 * reaches the person's next request rather than their next hour.
 */
export const setDashboardRole = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "settings.access");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const email = requireString(data["email"], "email", 320).trim().toLowerCase();
  const role = data["role"] === null ? null : data["role"];
  if (role !== null && !isRole(role)) throw new HttpsError("invalid-argument", `role must be one of ${ROLES.join(", ")}, or null to remove it`);
  let user;
  try {
    user = await auth().getUserByEmail(email);
  } catch {
    throw new HttpsError("not-found", `${email} has never signed in. Ask them to sign in to the dashboard once, then grant the role.`);
  }
  const claims = { ...((user.customClaims ?? {}) as Record<string, unknown>) };
  if (claims["device"] === true) throw new HttpsError("failed-precondition", "That account is a survey device, not a person.");
  if (role !== null && !emailAllowed(email, await accessPolicy(true))) {
    throw new HttpsError("failed-precondition", `${email} is not on the access list. Add it (or its Workspace domain) under Access first.`);
  }
  if (user.uid === actor.uid && role !== "owner") {
    throw new HttpsError("failed-precondition", "You cannot remove your own administrator role. Ask another administrator.");
  }
  const before = isRole(claims["role"]) ? (claims["role"] as Role) : null;
  if (role === null) delete claims["role"];
  else claims["role"] = role;
  await auth().setCustomUserClaims(user.uid, claims);
  await auth().revokeRefreshTokens(user.uid);
  forgetAccount(user.uid);
  await dash().doc(dpaths.user(user.uid)).set({ email, role, roleChangedAt: FieldValue.serverTimestamp(), roleChangedBy: actor.uid }, { merge: true });
  await audit({ action: "role.changed", ...actorFields(actor), target: { type: "user", id: user.uid }, detail: { email, before, after: role } });
  return { uid: user.uid, email, role };
});

export const rebuildSummaries = onCall({ ...callableOptions, timeoutSeconds: 540, memory: "1GiB" }, async (request) => {
  const actor = await requireActor(request, "data.rebuild");
  const onlyUnknownRelease = (request.data as Record<string, unknown> | undefined)?.["onlyUnknownRelease"] === true;
  const result = await rebuildAll({ onlyUnknownRelease });
  resetStore();
  await audit({ action: "summaries.rebuilt", ...actorFields(actor), detail: { ...result, onlyUnknownRelease } });
  return result;
});

/** Register a release manifest from the Settings page (the sync script does the same). */
export const registerReleaseManifest = onCall({ ...callableOptions, memory: "512MiB" }, async (request) => {
  const actor = await requireActor(request, "settings.policy");
  const manifest = (request.data as Record<string, unknown> | undefined)?.["manifest"];
  try {
    const meta = await registerRelease(manifest, STUDY, actor.uid);
    await audit({ action: "release.registered", ...actorFields(actor), target: { type: "release", id: meta.hash }, detail: { version: meta.version, key: meta.key } });
    return releaseView(meta);
  } catch (error) {
    if (error instanceof ReleaseRejected) throw new HttpsError("invalid-argument", error.message);
    throw error;
  }
});

/** A chart's data table downloaded from the browser (aggregate, non-sensitive) — recorded. */
export const logChartDownload = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "export.aggregate");
  const chart = typeof (request.data as Record<string, unknown> | undefined)?.["chart"] === "string" ? String((request.data as Record<string, unknown>)["chart"]).slice(0, 80) : "unknown";
  await audit({ action: "chart_data.downloaded", ...actorFields(actor), target: { type: "chart", id: chart } });
  void can;
  return { ok: true };
});
