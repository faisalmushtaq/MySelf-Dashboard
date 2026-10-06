import {
  accessListProblem,
  can,
  decideStudyAccess,
  emailAllowed,
  FIGURE_WIDTHS,
  isRole,
  PANEL_KINDS,
  policySchema,
  readAccessList,
  ROLES,
  type PersonView,
  type Role,
  type SettingsResponse,
} from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { actorFields, audit } from "../audit.js";
import { forgetAccount, requireActor, requireStudyActor } from "../authz.js";
import { auth, dash, DEFAULT_STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { registerRelease, releaseList, ReleaseRejected } from "../releases.js";
import { accessPolicy, invalidateSettings, studyAccessList, studyPolicy } from "../settings.js";
import { registeredStudies } from "../studies.js";
import { rebuildAll } from "../summaries.js";
import { resetStore } from "../store.js";
import { callableOptions, releaseView, requireString } from "./common.js";

/**
 * Administration: who may use the dashboard and what the numbers mean. Every
 * callable here requires the Administrator role, is audited, and refuses the
 * changes that would lock the study out of its own administration. The access
 * list and roles are the dashboard's; the policy, the registry and the rebuilds
 * are the study the administrator is working in (docs/12 §12.3).
 */

async function people(access: { emails: string[]; domains: string[] }): Promise<PersonView[]> {
  const studies = await registeredStudies(true);
  const lists = new Map(await Promise.all(studies.map(async (s) => [s.study, await studyAccessList(s.study, true)] as const)));
  const out: PersonView[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      // Survey devices sign in anonymously or carry a device claim: not people.
      if (claims["device"] === true || !u.email) continue;
      const role = isRole(claims["role"]) ? claims["role"] : null;
      const allowed = emailAllowed(u.email, access);
      const email = u.email.toLowerCase();
      out.push({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName ?? null,
        role,
        allowed,
        disabled: u.disabled,
        lastSignIn: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        studies:
          role && allowed && !u.disabled
            ? studies.filter((s) => decideStudyAccess({ role, email, study: s.study, defaultStudy: DEFAULT_STUDY, list: lists.get(s.study) ?? null })).map((s) => s.study)
            : [],
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return out.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

/** The dashboard's access list and people, and the study's policy and registry. */
export const getSettings = onCall(callableOptions, async (request): Promise<SettingsResponse> => {
  const actor = await requireStudyActor(request, "settings.access");
  const [access, policy, metas] = await Promise.all([accessPolicy(true), studyPolicy(actor.study, true), releaseList(actor.study, true)]);
  return { access, policy, people: await people(access), releases: metas.map(releaseView) };
});

/**
 * Who may use the dashboard at all — and see the default study. Public mail
 * services are refused as domain rules (docs/12 §12.4). The default study's id
 * is written beside the list, for the security rules, which have no other way
 * to know it (they read `ybm` when it is absent).
 */
export const updateAccessPolicy = onCall(callableOptions, async (request) => {
  const actor = await requireActor(request, "settings.access");
  const next = readAccessList(request.data);
  const problem = accessListProblem(next);
  if (problem) throw new HttpsError("invalid-argument", problem);
  if (!emailAllowed(actor.email, next)) {
    throw new HttpsError("failed-precondition", "That change would remove your own access. Ask another administrator to make it.");
  }
  const before = await accessPolicy(true);
  await dash().doc(dpaths.accessConfig()).set({ ...next, defaultStudy: DEFAULT_STUDY, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  invalidateSettings();
  await audit({ action: "access_policy.changed", ...actorFields(actor), detail: { before, after: next } });
  return next;
});

/** The study's settings: the default study's in config/policy, any other's its own (docs/12 §12.3). */
export const updatePolicy = onCall(callableOptions, async (request) => {
  const actor = await requireStudyActor(request, "settings.policy");
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
  const active = parsed.data.activeReleaseHash;
  if (active && !(await releaseList(actor.study, true)).some((m) => m.hash === active)) {
    throw new HttpsError("invalid-argument", "The active version must be a version registered in this study.");
  }
  const before = await studyPolicy(actor.study, true);
  await dash().doc(dpaths.policyConfig(actor.study)).set({ ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  invalidateSettings();
  resetStore(actor.study);
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

/** Rebuild the summaries of the study the administrator is working in. */
export const rebuildSummaries = onCall({ ...callableOptions, timeoutSeconds: 540, memory: "1GiB" }, async (request) => {
  const actor = await requireStudyActor(request, "data.rebuild");
  const onlyUnknownRelease = (request.data as Record<string, unknown> | undefined)?.["onlyUnknownRelease"] === true;
  const result = await rebuildAll(actor.study, { onlyUnknownRelease });
  resetStore(actor.study);
  await audit({ action: "summaries.rebuilt", ...actorFields(actor), detail: { ...result, onlyUnknownRelease } });
  return result;
});

/** Register a release manifest from the Settings page (the sync script does the same): only one of this study's. */
export const registerReleaseManifest = onCall({ ...callableOptions, memory: "512MiB" }, async (request) => {
  const actor = await requireStudyActor(request, "settings.policy");
  const manifest = (request.data as Record<string, unknown> | undefined)?.["manifest"];
  try {
    const meta = await registerRelease(manifest, actor.study, actor.uid);
    await audit({ action: "release.registered", ...actorFields(actor), target: { type: "release", id: meta.hash }, detail: { version: meta.version, key: meta.key } });
    return releaseView(meta);
  } catch (error) {
    if (error instanceof ReleaseRejected) throw new HttpsError("invalid-argument", error.message);
    throw error;
  }
});

/** A chart's data table downloaded from the browser (aggregate, non-sensitive) — recorded. */
const FIGURE_FORMATS = ["pdf", "svg", "png", "tiff", "csv"] as const;

/**
 * Figures are drawn in the browser from aggregates the server already
 * authorised; this records each figure file (and its source data) leaving the
 * dashboard, like any other download.
 */
export const logFigureExport = onCall(callableOptions, async (request) => {
  const actor = await requireStudyActor(request, "export.aggregate");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const format = data["format"];
  const panels = data["panels"];
  const width = data["width"];
  const dpi = data["dpi"];
  if (typeof format !== "string" || !(FIGURE_FORMATS as readonly string[]).includes(format)) throw new HttpsError("invalid-argument", "unknown figure format");
  if (!Array.isArray(panels) || panels.length < 1 || panels.length > 6 || !panels.every((p) => (PANEL_KINDS as readonly unknown[]).includes(p))) {
    throw new HttpsError("invalid-argument", "unknown figure panels");
  }
  if (typeof width !== "string" || !(width in FIGURE_WIDTHS)) throw new HttpsError("invalid-argument", "unknown figure width");
  if (dpi !== undefined && dpi !== null && !(typeof dpi === "number" && Number.isInteger(dpi) && dpi >= 72 && dpi <= 1200)) {
    throw new HttpsError("invalid-argument", "resolution out of range");
  }
  await audit({
    action: "figure.exported",
    ...actorFields(actor),
    target: { type: "figure", id: (panels as string[]).join("+") },
    detail: { format, width, dpi: typeof dpi === "number" ? dpi : null, colour: data["colour"] === "greyscale" ? "greyscale" : "colour" },
  });
  return { ok: true };
});

export const logChartDownload = onCall(callableOptions, async (request) => {
  const actor = await requireStudyActor(request, "export.aggregate");
  const chart = typeof (request.data as Record<string, unknown> | undefined)?.["chart"] === "string" ? String((request.data as Record<string, unknown>)["chart"]).slice(0, 80) : "unknown";
  await audit({ action: "chart_data.downloaded", ...actorFields(actor), target: { type: "chart", id: chart } });
  void can;
  return { ok: true };
});
