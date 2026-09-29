#!/usr/bin/env node
/**
 * Make the first dashboard administrator, once.
 *
 *   node scripts/bootstrap-admin.mjs --project myself-research --email brainpopresearch@gmail.com [--domain brainpop.example]
 *
 * Somebody has to be first, and being first cannot go through a permission
 * check nobody can yet pass (the survey's grant-role.mjs says the same). This
 * runs with YOUR application-default credentials and does only what you could
 * already do in the Firebase console:
 *
 *   1. adds the email (and optional Workspace domain) to config/access, keeping
 *      whatever is already there;
 *   2. gives that account the `owner` role claim (Administrator), keeping any
 *      other claims it has, and revokes its refresh tokens so the role applies at
 *      the next sign-in.
 *
 * The account must have signed in to the dashboard once first (an account is
 * created by signing in). After this, everyone else is managed in Settings.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = arg("project");
const email = arg("email")?.trim().toLowerCase();
const domain = arg("domain")?.trim().toLowerCase().replace(/^@/, "");
if (!project || !email) {
  console.error("Usage: node scripts/bootstrap-admin.mjs --project <id> --email <address> [--domain <workspace-domain>]");
  process.exit(2);
}

const app = initializeApp({ projectId: project });
const db = getFirestore(app, "dashboard");
const ref = db.doc("config/access");
const snap = await ref.get();
const current = snap.exists ? snap.data() : {};
const emails = [...new Set([...(current.emails ?? []), email])];
const domains = [...new Set([...(current.domains ?? []), ...(domain ? [domain] : [])])];
await ref.set({ emails, domains, updatedAt: FieldValue.serverTimestamp(), updatedBy: "scripts/bootstrap-admin.mjs" });
console.log(`access list: ${emails.length} account(s), ${domains.length} domain(s)`);

let user;
try {
  user = await getAuth(app).getUserByEmail(email);
} catch {
  console.error(`${email} has not signed in yet. Open the dashboard, sign in with Google once (you will see "Access not granted"), then run this again.`);
  process.exit(1);
}
if (user.customClaims?.role === "owner") {
  console.log(`${email} is already an Administrator; role unchanged.`);
  process.exit(0);
}
const claims = { ...(user.customClaims ?? {}), role: "owner" };
await getAuth(app).setCustomUserClaims(user.uid, claims);
await getAuth(app).revokeRefreshTokens(user.uid);
await db.collection("studies").doc(process.env.MYSELF_STUDY ?? "ybm").collection("auditLog").add({
  action: "role.changed",
  actorUid: null,
  actorEmail: "bootstrap (application-default credentials)",
  actorRole: null,
  target: { type: "user", id: user.uid },
  detail: { email, before: user.customClaims?.role ?? null, after: "owner" },
  outcome: "success",
  at: FieldValue.serverTimestamp(),
});
console.log(`${email} is now an Administrator. Sign out and back in to pick up the role.`);
