import { CAPABILITIES, can, decideStudyAccess, type PublicPolicy, type StudyView, type WhoAmIResponse } from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { audit } from "../audit.js";
import { evaluate } from "../authz.js";
import { dash, DEFAULT_STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { studyAccessList, studyPolicy } from "../settings.js";
import { registeredStudies, studyView } from "../studies.js";
import { callableOptions } from "./common.js";

/**
 * Who am I, and may I use the dashboard?
 *
 * The first call the app makes after sign-in, and the only one that answers an
 * unauthorised caller with something other than an error: the app needs to know
 * WHY (not approved, no role, unverified) to say it plainly — silence looks like a
 * bug and invites a workaround (docs/13 §3 in the survey repo says the same).
 *
 * It also says which studies the person may see and which one they are working
 * in (docs/12 §12.7): the one asked for, else the one they last chose, else the
 * default — never one they may not see. Choosing a study is remembered for them,
 * on the server, so it follows them to any browser.
 *
 * Every sign-in and every refusal is audited. Refusals are throttled per account
 * so a page left open on a refused account cannot flood the log.
 */

const deniedRecently = new Map<string, number>();

export const publicPolicy = (p: Awaited<ReturnType<typeof studyPolicy>>): PublicPolicy => ({
  timeZone: p.timeZone,
  abandonAfterHours: p.abandonAfterHours,
  requiredLevels: p.requiredLevels,
  reviewerCanViewFreeText: p.reviewerCanViewFreeText,
  exportRetentionHours: p.exportRetentionHours,
  tooFastWarningCount: p.tooFastWarningCount,
  testCodePatterns: p.testCodePatterns,
  activeReleaseHash: p.activeReleaseHash,
});

export const whoAmI = onCall(callableOptions, async (request): Promise<WhoAmIResponse> => {
  const { decision, token } = await evaluate(request);
  const data = (request.data ?? {}) as { signIn?: unknown; study?: unknown };
  const signIn = data.signIn === true;
  if (!decision.ok) {
    const key = token?.uid ?? "anonymous";
    const last = deniedRecently.get(key) ?? 0;
    if (Date.now() - last > 10 * 60_000) {
      deniedRecently.set(key, Date.now());
      await audit({
        action: "auth.denied",
        actorUid: token?.uid ?? null,
        actorEmail: token?.email?.toLowerCase() ?? null,
        actorRole: null,
        detail: { reason: decision.audit },
        outcome: "denied",
      });
    }
    return {
      authorised: false,
      reason: decision.reason,
      email: token?.email ?? null,
      uid: token?.uid ?? null,
      role: null,
      capabilities: [],
      policy: null,
      study: DEFAULT_STUDY,
      defaultStudy: DEFAULT_STUDY,
      studies: [],
    };
  }
  const uid = request.auth!.uid;
  const userRef = dash().doc(dpaths.user(uid));
  const [registered, userSnap] = await Promise.all([registeredStudies(), userRef.get()]);
  const visible: StudyView[] = [];
  for (const s of registered) {
    const list = await studyAccessList(s.study);
    if (decideStudyAccess({ role: decision.role, email: decision.email, study: s.study, defaultStudy: DEFAULT_STUDY, list })) visible.push(await studyView(s));
  }
  const ids = new Set(visible.map((s) => s.study));
  const asked = typeof data.study === "string" && ids.has(data.study) ? data.study : null;
  const remembered = userSnap.get("study");
  const study = asked ?? (typeof remembered === "string" && ids.has(remembered) ? remembered : DEFAULT_STUDY);
  const policy = await studyPolicy(study);
  if (signIn) {
    await audit({ action: "auth.signed_in", actorUid: uid, actorEmail: decision.email, actorRole: decision.role });
  }
  await userRef.set({ email: decision.email, role: decision.role, lastSeenAt: FieldValue.serverTimestamp(), ...(asked ? { study: asked } : {}) }, { merge: true });
  return {
    authorised: true,
    reason: null,
    email: decision.email,
    uid,
    role: decision.role,
    capabilities: CAPABILITIES.filter((c) => can(decision.role, c, policy)),
    policy: publicPolicy(policy),
    study,
    defaultStudy: DEFAULT_STUDY,
    studies: visible,
  };
});
