import { CAPABILITIES, can, type PublicPolicy, type WhoAmIResponse } from "@myself-dashboard/core";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { audit } from "../audit.js";
import { evaluate } from "../authz.js";
import { dash, STUDY } from "../env.js";
import { dpaths } from "../paths.js";
import { studyPolicy } from "../settings.js";
import { callableOptions } from "./common.js";

/**
 * Who am I, and may I use the dashboard?
 *
 * The first call the app makes after sign-in, and the only one that answers an
 * unauthorised caller with something other than an error: the app needs to know
 * WHY (not approved, no role, unverified) to say it plainly — silence looks like a
 * bug and invites a workaround (docs/13 §3 in the survey repo says the same).
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
  const signIn = (request.data as { signIn?: boolean } | undefined)?.signIn === true;
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
      study: STUDY,
    };
  }
  const policy = await studyPolicy();
  const uid = request.auth!.uid;
  if (signIn) {
    await audit({ action: "auth.signed_in", actorUid: uid, actorEmail: decision.email, actorRole: decision.role });
  }
  await dash()
    .doc(dpaths.user(uid))
    .set({ email: decision.email, role: decision.role, lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
  return {
    authorised: true,
    reason: null,
    email: decision.email,
    uid,
    role: decision.role,
    capabilities: CAPABILITIES.filter((c) => can(decision.role, c, policy)),
    policy: publicPolicy(policy),
    study: STUDY,
  };
});
