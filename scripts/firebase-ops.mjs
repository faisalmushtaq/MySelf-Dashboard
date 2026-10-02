#!/usr/bin/env node
/**
 * First-time setup of the dashboard in the Firebase project, run by
 * .github/workflows/firebase-setup.yml with the deploy service account.
 *
 *   node scripts/firebase-ops.mjs preflight   # read-only report, changes nothing
 *   node scripts/firebase-ops.mjs prepare     # dashboard database, Hosting site, web app, sign-in domains
 *   node scripts/firebase-ops.mjs finish      # first administrator, summary backfill, smoke test
 *
 * Everything here adds the dashboard's OWN resources. It never changes the
 * survey's database, rules, functions, Hosting site or data. It prints
 * configuration only — never a participant record, a key, or a person's
 * account other than the dashboard administrator named below.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS (the workflow writes it from the
 * FIREBASE_SERVICE_ACCOUNT secret and deletes it afterwards).
 */
import { appendFileSync, readFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT = "myself-research";
const STUDY = "ybm";
const DATABASE = "dashboard";
const SITE = process.env.DASHBOARD_SITE || "myself-research-dashboard";
const ADMIN_EMAIL = "brainpopresearch@gmail.com";
const WEB_APP_NAME = "MySelf Research Dashboard";
const REQUIRED_APIS = [
  "firestore.googleapis.com",
  "cloudfunctions.googleapis.com",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "eventarc.googleapis.com",
  "pubsub.googleapis.com",
  "cloudscheduler.googleapis.com",
  "firebasehosting.googleapis.com",
  "identitytoolkit.googleapis.com",
  "firebaserules.googleapis.com",
  "storage.googleapis.com",
];

/** The functions the dashboard deploys (apps/functions/src/index.ts). */
const DASHBOARD_FUNCTIONS = [
  "onSessionWritten", "onOpsRequest", "whoAmI", "querySessions", "getSessionDetail", "getAnalytics", "getQuestionAnalytics",
  "getQuestionHistory", "updateReview", "addNote", "getSettings", "updateAccessPolicy", "updatePolicy", "setDashboardRole",
  "rebuildSummaries", "registerReleaseManifest", "logChartDownload", "logFigureExport", "previewExport", "createExport",
  "downloadExport", "cleanupExports",
];

const mode = process.argv[2];
if (!["preflight", "prepare", "finish"].includes(mode)) {
  console.error("usage: node scripts/firebase-ops.mjs preflight|prepare|finish");
  process.exit(2);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  process.exit(2);
}
const key = JSON.parse(readFileSync(keyPath, "utf8"));
if (key.project_id !== PROJECT) {
  console.error(`The key belongs to project "${key.project_id}", not "${PROJECT}". Create the key in ${PROJECT}.`);
  process.exit(1);
}

const credential = applicationDefault();
const app = initializeApp({ credential, projectId: PROJECT });
const findings = [];
const ok = (label, detail = "") => findings.push({ ok: true, label, detail }) && console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => findings.push({ ok: false, label, detail }) && console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
const note = (label, detail = "") => console.log(`  • ${label}${detail ? ` — ${detail}` : ""}`);
const section = (title) => console.log(`\n${title}`);

async function api(method, url, body) {
  const { access_token } = await credential.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", "x-goog-user-project": PROJECT },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

const errorOf = (r) => r.json?.error?.message ?? r.text.slice(0, 200);

async function waitOperation(url, what) {
  for (let i = 0; i < 90; i += 1) {
    const r = await api("GET", url);
    if (r.json?.done) {
      if (r.json.error) throw new Error(`${what}: ${r.json.error.message}`);
      return r.json.response ?? r.json;
    }
    await new Promise((s) => setTimeout(s, 4000));
  }
  throw new Error(`${what}: timed out`);
}

function exportEnv(name, value) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}

// ── Reads shared by the modes ─────────────────────────────────────────────────

async function databases() {
  const r = await api("GET", `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases`);
  return r.ok ? (r.json.databases ?? []) : null;
}

async function sites() {
  const r = await api("GET", `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT}/sites`);
  return r.ok ? (r.json.sites ?? []) : null;
}

async function webApps() {
  const r = await api("GET", `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps`);
  return r.ok ? (r.json.apps ?? []) : null;
}

async function authConfig() {
  return api("GET", `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`);
}

const siteDomains = [`${SITE}.web.app`, `${SITE}.firebaseapp.com`];

// ── preflight ─────────────────────────────────────────────────────────────────

async function preflight() {
  console.log(`Project ${PROJECT}, as ${key.client_email}`);

  section("Access");
  const proj = await api("GET", `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`);
  if (!proj.ok) {
    bad("the key can read the project", errorOf(proj));
    return;
  }
  ok("the key can read the project", `${proj.json.name}, ${proj.json.lifecycleState}, project number ${proj.json.projectNumber}`);
  const number = proj.json.projectNumber;

  const iam = await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`, {});
  if (iam.ok) {
    const rolesOf = (member) => (iam.json.bindings ?? []).filter((b) => b.members?.includes(member)).map((b) => b.role);
    const mine = rolesOf(`serviceAccount:${key.client_email}`);
    (mine.includes("roles/editor") || mine.includes("roles/owner") ? ok : bad)("deploy account roles", mine.join(", ") || "none");
    const compute = rolesOf(`serviceAccount:${number}-compute@developer.gserviceaccount.com`);
    (compute.length ? ok : bad)("functions runtime account roles", compute.join(", ") || "none — functions could not read Firestore");
  } else note("IAM policy not readable", errorOf(iam));

  // What the setup stage will do, as permissions: the answer comes from IAM
  // itself (testIamPermissions), not from guessing what a role contains.
  const needs = [
    ["datastore.databases.create", "create the dashboard database", "Cloud Datastore Owner"],
    ["datastore.indexes.create", "deploy the dashboard's indexes", "Cloud Datastore Index Admin"],
    ["firebaserules.releases.create", "deploy the dashboard's rules", "Firebase Rules Admin"],
    ["firebasehosting.sites.create", "create the Hosting site", "Firebase Hosting Admin"],
    ["firebase.clients.create", "register the web app", "Firebase Admin"],
    ["firebaseauth.configs.update", "authorise the dashboard's sign-in domain", "Firebase Authentication Admin"],
    ["firebaseauth.users.update", "make the first Administrator", "Firebase Authentication Admin"],
    ["cloudfunctions.functions.create", "deploy the functions", "Cloud Functions Admin"],
    ["run.services.setIamPolicy", "let browsers call the functions (public invoker)", "Cloud Run Admin"],
    ["cloudfunctions.functions.setIamPolicy", "make the HTTPS download function public", "Cloud Functions Admin"],
    ["iam.serviceAccounts.actAs", "run functions as the runtime account", "Service Account User"],
    ["eventarc.triggers.create", "deploy the Firestore triggers", "Eventarc Admin"],
    ["cloudscheduler.jobs.create", "schedule export clean-up", "Cloud Scheduler Admin"],
    ["serviceusage.services.enable", "enable any missing API", "Service Usage Admin"],
    ["datastore.entities.create", "register survey versions and the access list", "Cloud Datastore User"],
  ];
  const test = await api("POST", `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`, { permissions: needs.map(([p]) => p) });
  if (test.ok) {
    const granted = new Set(test.json.permissions ?? []);
    const missing = needs.filter(([p]) => !granted.has(p));
    if (missing.length) {
      for (const [p, why, role] of missing) bad(`missing permission to ${why}`, `${p} — role "${role}"`);
    } else ok("the deploy account has every permission setup needs");
  } else note("permissions could not be tested", errorOf(test));

  section("APIs");
  const enabled = new Set();
  let token = "";
  for (let page = 0; page < 10; page += 1) {
    const r = await api("GET", `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state:ENABLED&pageSize=200${token ? `&pageToken=${token}` : ""}`);
    if (!r.ok) {
      note("enabled APIs not readable", errorOf(r));
      break;
    }
    for (const s of r.json.services ?? []) enabled.add(s.config?.name ?? s.name.split("/").pop());
    token = r.json.nextPageToken ?? "";
    if (!token) break;
  }
  if (enabled.size) {
    const missing = REQUIRED_APIS.filter((a) => !enabled.has(a));
    (missing.length ? note : ok)(missing.length ? "APIs the first deploy will enable" : "every API the dashboard needs is on", missing.join(", "));
  }

  section("Firestore");
  const dbs = await databases();
  if (!dbs) bad("databases readable");
  else {
    for (const d of dbs) note(`database ${d.name.split("/").pop()}`, `${d.locationId}, ${d.type}${d.deleteProtectionState === "DELETE_PROTECTION_ENABLED" ? ", delete-protected" : ""}`);
    const def = dbs.find((d) => d.name.endsWith("/(default)"));
    (def ? ok : bad)("the survey database exists", def ? def.locationId : "no (default) database");
    const mine = dbs.find((d) => d.name.endsWith(`/${DATABASE}`));
    mine ? ok("dashboard database already exists", mine.locationId) : note("dashboard database will be created", def?.locationId ?? "?");
  }

  section("Hosting");
  const ss = await sites();
  if (!ss) bad("Hosting sites readable");
  else {
    for (const s of ss) note(`site ${s.name.split("/").pop()}`, s.defaultUrl ?? "");
    ss.some((s) => s.name.endsWith(`/${SITE}`)) ? ok(`site ${SITE} exists`) : note(`site ${SITE} will be created`);
  }

  section("Web apps and sign-in");
  const apps = await webApps();
  if (!apps) bad("web apps readable");
  else for (const a of apps) note(`web app "${a.displayName ?? "(unnamed)"}"`, a.appId);
  const cfg = await authConfig();
  if (cfg.ok) {
    ok("Authentication is set up");
    note("authorised domains", (cfg.json.authorizedDomains ?? []).join(", "));
    const missing = siteDomains.filter((d) => !(cfg.json.authorizedDomains ?? []).includes(d));
    missing.length ? note("domains that will be authorised", missing.join(", ")) : ok("dashboard domains already authorised");
  } else bad("Authentication config readable", errorOf(cfg));
  const google = await api("GET", `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/defaultSupportedIdpConfigs/google.com`);
  (google.ok && google.json.enabled ? ok : bad)("Google sign-in enabled", google.ok ? String(!!google.json.enabled) : errorOf(google));

  const keys = await api("GET", `https://apikeys.googleapis.com/v2/projects/${PROJECT}/locations/global/keys`);
  if (keys.ok) {
    for (const k of keys.json.keys ?? []) {
      const r = k.restrictions ?? {};
      const refs = r.browserKeyRestrictions?.allowedReferrers;
      const targets = (r.apiTargets ?? []).map((t) => t.service).join(", ");
      note(`API key "${k.displayName ?? k.uid}"`, `${refs ? `referrers: ${refs.join(", ")}` : "no referrer restriction"}${targets ? `; APIs: ${targets}` : ""}`);
    }
  } else note("API keys not readable", errorOf(keys));

  const appCheck = await api("GET", `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/services`);
  if (appCheck.ok) {
    const enforced = (appCheck.json.services ?? []).filter((s) => s.enforcementMode === "ENFORCED").map((s) => s.name.split("/").pop());
    enforced.length ? bad("App Check enforced (the dashboard does not use App Check)", enforced.join(", ")) : ok("App Check not enforced");
  } else note("App Check settings not readable", errorOf(appCheck));

  section("Storage");
  const buckets = await api("GET", `https://storage.googleapis.com/storage/v1/b?project=${PROJECT}`);
  if (buckets.ok) {
    const names = (buckets.json.items ?? []).map((b) => `${b.name} (${b.location})`);
    note("buckets", names.join(", ") || "none");
    const def = (buckets.json.items ?? []).find((b) => b.name === `${PROJECT}.appspot.com` || b.name === `${PROJECT}.firebasestorage.app`);
    (def ? ok : bad)("default bucket for exports", def ? def.name : "none — exports need the project's default Storage bucket");
  } else bad("buckets readable", errorOf(buckets));

  section("Functions");
  const fns = await api("GET", `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions?pageSize=200`);
  if (fns.ok) {
    const list = fns.json.functions ?? [];
    const byCodebase = new Map();
    for (const f of list) {
      const cb = f.labels?.["firebase-functions-codebase"] ?? "default";
      byCodebase.set(cb, (byCodebase.get(cb) ?? 0) + 1);
    }
    note("deployed functions", [...byCodebase].map(([cb, n]) => `${n} in codebase "${cb}"`).join(", ") || "none");
    const events = list.filter((f) => f.eventTrigger).length;
    note("event-driven functions already in the project", String(events));
    const taken = list
      .filter((f) => (f.labels?.["firebase-functions-codebase"] ?? "default") !== "dashboard")
      .map((f) => f.name.split("/").pop())
      .filter((n) => DASHBOARD_FUNCTIONS.includes(n));
    (taken.length ? bad : ok)("no name clashes with the dashboard's functions", taken.join(", "));
    (byCodebase.has("dashboard") ? note : ok)(byCodebase.has("dashboard") ? "dashboard functions already deployed" : "no dashboard functions yet");
  } else bad("functions readable", errorOf(fns));

  section("Dashboard administrator");
  try {
    const user = await getAuth(app).getUserByEmail(ADMIN_EMAIL);
    const providers = user.providerData.map((p) => p.providerId).join(", ");
    ok(`${ADMIN_EMAIL} has an account`, `sign-in: ${providers || "none"}; role: ${user.customClaims?.role ?? "none"}; disabled: ${user.disabled}`);
  } catch (e) {
    note(`${ADMIN_EMAIL} has not signed in to this project yet`, String(e.code ?? e.message));
  }

  const failed = findings.filter((f) => !f.ok);
  console.log(`\n${failed.length ? `${failed.length} problem(s) to resolve before setup` : "Ready for setup"}.`);
}

// ── prepare ───────────────────────────────────────────────────────────────────

async function prepare() {
  section("Dashboard database");
  const dbs = (await databases()) ?? [];
  const def = dbs.find((d) => d.name.endsWith("/(default)"));
  if (!def) throw new Error("The survey's (default) database was not found.");
  if (dbs.some((d) => d.name.endsWith(`/${DATABASE}`))) ok("already exists");
  else {
    const r = await api("POST", `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases?databaseId=${DATABASE}`, {
      locationId: def.locationId,
      type: "FIRESTORE_NATIVE",
      deleteProtectionState: "DELETE_PROTECTION_ENABLED",
      pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED",
    });
    if (!r.ok) throw new Error(`creating the dashboard database: ${errorOf(r)}`);
    await waitOperation(`https://firestore.googleapis.com/v1/${r.json.name}`, "creating the dashboard database");
    ok("created", `${def.locationId}, delete-protected, point-in-time recovery on`);
  }
  const schedules = await api("GET", `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/backupSchedules`);
  if (schedules.ok && (schedules.json.backupSchedules ?? []).length) ok("backups already scheduled");
  else {
    const r = await api("POST", `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/backupSchedules`, { retention: "604800s", dailyRecurrence: {} });
    r.ok ? ok("daily backups scheduled", "kept 7 days") : note("backups not scheduled", errorOf(r));
  }

  section("Hosting site");
  const ss = (await sites()) ?? [];
  if (ss.some((s) => s.name.endsWith(`/${SITE}`))) ok(`${SITE} already exists`);
  else {
    const r = await api("POST", `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT}/sites?siteId=${SITE}`, {});
    if (!r.ok) throw new Error(`creating Hosting site ${SITE}: ${errorOf(r)} (site names are global; set DASHBOARD_SITE to another name)`);
    ok(`${SITE} created`, r.json.defaultUrl ?? "");
  }

  section("Web app");
  let apps = (await webApps()) ?? [];
  let web = apps.find((a) => a.displayName === WEB_APP_NAME);
  if (web) ok("already registered", web.appId);
  else {
    const r = await api("POST", `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps`, { displayName: WEB_APP_NAME });
    if (!r.ok) throw new Error(`registering the web app: ${errorOf(r)}`);
    await waitOperation(`https://firebase.googleapis.com/v1beta1/${r.json.name}`, "registering the web app");
    apps = (await webApps()) ?? [];
    web = apps.find((a) => a.displayName === WEB_APP_NAME);
    if (!web) throw new Error("the web app was registered but cannot be found");
    ok("registered", web.appId);
  }
  const conf = await api("GET", `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps/${web.appId}/config`);
  if (!conf.ok) throw new Error(`reading the web app config: ${errorOf(conf)}`);
  const c = conf.json;
  const webConfig = { apiKey: c.apiKey, authDomain: c.authDomain ?? `${PROJECT}.firebaseapp.com`, projectId: c.projectId, appId: c.appId, messagingSenderId: c.messagingSenderId };
  exportEnv("VITE_FIREBASE_CONFIG", JSON.stringify(webConfig));
  ok("web config ready for the build", `authDomain ${webConfig.authDomain}`);

  section("Sign-in domains");
  const cfg = await authConfig();
  if (!cfg.ok) throw new Error(`reading Authentication settings: ${errorOf(cfg)}`);
  const current = cfg.json.authorizedDomains ?? [];
  const wanted = [...new Set([...current, ...siteDomains])];
  if (wanted.length === current.length) ok("dashboard domains already authorised");
  else {
    const r = await api("PATCH", `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=authorizedDomains`, { authorizedDomains: wanted });
    if (!r.ok) throw new Error(`authorising the dashboard domains: ${errorOf(r)}`);
    ok("authorised", siteDomains.join(", "));
  }

  section("Browser API key");
  const keys = await api("GET", `https://apikeys.googleapis.com/v2/projects/${PROJECT}/locations/global/keys`);
  if (keys.ok) {
    for (const k of keys.json.keys ?? []) {
      const ks = await api("GET", `https://apikeys.googleapis.com/v2/${k.name}/keyString`);
      if (!ks.ok || ks.json.keyString !== webConfig.apiKey) continue;
      const refs = k.restrictions?.browserKeyRestrictions?.allowedReferrers;
      if (!refs) {
        ok(`the web API key has no referrer restriction`);
        break;
      }
      const add = siteDomains.map((d) => `https://${d}/*`).filter((r) => !refs.includes(r));
      if (!add.length) ok("dashboard allowed by the key's referrer list");
      else {
        const r = await api("PATCH", `https://apikeys.googleapis.com/v2/${k.name}?updateMask=restrictions`, {
          restrictions: { ...k.restrictions, browserKeyRestrictions: { allowedReferrers: [...refs, ...add] } },
        });
        if (!r.ok) throw new Error(`allowing the dashboard on the API key: ${errorOf(r)}`);
        ok("dashboard added to the key's referrer list", add.join(", "));
      }
      break;
    }
  } else note("API keys not readable; if sign-in fails, allow the dashboard domain on the browser key", errorOf(keys));
}

// ── finish ────────────────────────────────────────────────────────────────────

async function finish() {
  const db = getFirestore(app, DATABASE);

  section("Administrator");
  const access = db.doc("config/access");
  const snap = await access.get();
  const cur = snap.exists ? snap.data() : {};
  const emails = [...new Set([...(cur.emails ?? []), ADMIN_EMAIL])];
  if (!snap.exists || !(cur.emails ?? []).includes(ADMIN_EMAIL)) {
    await access.set({ emails, domains: cur.domains ?? [], updatedAt: FieldValue.serverTimestamp(), updatedBy: "firebase-setup workflow" });
    ok("access list", `${ADMIN_EMAIL} allowed`);
  } else ok("access list already includes the administrator");
  try {
    const user = await getAuth(app).getUserByEmail(ADMIN_EMAIL);
    if (user.customClaims?.role === "owner") ok(`${ADMIN_EMAIL} is already an Administrator`, "role unchanged, no sign-out");
    else {
      await getAuth(app).setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: "owner" });
      await getAuth(app).revokeRefreshTokens(user.uid);
      await db.collection("studies").doc(STUDY).collection("auditLog").add({
        action: "role.changed",
        actorUid: null,
        actorEmail: "firebase-setup workflow",
        actorRole: null,
        target: { type: "user", id: user.uid },
        detail: { email: ADMIN_EMAIL, from: user.customClaims?.role ?? null, to: "owner" },
        outcome: "success",
        at: FieldValue.serverTimestamp(),
      });
      ok(`${ADMIN_EMAIL} made Administrator`, `was ${user.customClaims?.role ?? "no role"}; sign in again to use it`);
    }
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    note(`${ADMIN_EMAIL} has not signed in yet`, "sign in to the dashboard once, then run this step again");
  }

  section("Summaries of existing sessions");
  const id = `backfill-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}`;
  const req = db.doc(`ops/${id}`);
  await req.set({ kind: "rebuild_summaries", requestedBy: `github-actions run ${process.env.GITHUB_RUN_ID ?? "local"}`, createdAt: FieldValue.serverTimestamp() });
  note("requested", "the dashboard's functions summarise every sitting inside Google Cloud");
  let last = "";
  for (let i = 0; i < 90; i += 1) {
    await new Promise((s) => setTimeout(s, 10_000));
    const d = (await req.get()).data() ?? {};
    if (d.status !== last) {
      last = d.status ?? "";
      note(`status: ${last || "waiting for the function"}`);
    }
    if (d.status === "done") {
      ok("summaries built", `${d.scanned} sittings read, ${d.written} summaries written, ${d.unreadable} unreadable`);
      break;
    }
    if (d.status === "failed" || d.status === "rejected") {
      bad("summary backfill", d.error ?? d.reason ?? d.status);
      break;
    }
  }
  if (!["done", "failed", "rejected"].includes(last)) bad("summary backfill", "still running after 15 minutes — check the onOpsRequest function logs");

  // What the dashboard now shows for the last week: counts only, by day (UK time) and survey version.
  section("Sittings in the dashboard, last seven days");
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recent = await db.collection(`studies/${STUDY}/sessionSummaries`).where("startedAt", ">=", since).select("startedAt", "completedAt", "releaseVersion", "releaseKnown", "deleted").get();
  const dayOf = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const days = new Map();
  let unregistered = 0;
  for (const d of recent.docs) {
    const x = d.data();
    if (x.deleted) continue;
    const e = days.get(dayOf(x.startedAt)) ?? { n: 0, finished: 0, versions: new Map() };
    const v = x.releaseKnown && x.releaseVersion ? `v${x.releaseVersion}` : "an unregistered version";
    if (v === "an unregistered version") unregistered += 1;
    e.n += 1;
    if (x.completedAt) e.finished += 1;
    e.versions.set(v, (e.versions.get(v) ?? 0) + 1);
    days.set(dayOf(x.startedAt), e);
  }
  if (!days.size) note("none", "no sittings started in the last seven days");
  for (const [day, e] of [...days].sort()) note(day, `${e.n} sittings, ${e.finished} finished — ${[...e.versions].map(([v, n]) => `${v}: ${n}`).join(", ")}`);
  if (unregistered) bad("sittings under a survey version the dashboard does not know", `${unregistered}; Survey versions says whether MySelf Studio published it and why it was not read. If Studio's copy checks out, re-summarise (Settings → Data maintenance); otherwise register the manifest (Settings → Survey versions, or releases/ and run setup again)`);

  section("Smoke test");
  const url = `https://${SITE}.web.app/`;
  const page = await fetch(url);
  const csp = page.headers.get("content-security-policy");
  (page.ok ? ok : bad)(`${url} responds`, String(page.status));
  (csp?.includes("frame-ancestors 'none'") ? ok : bad)("security headers served", csp ? "CSP present" : "no CSP header");
  const callable = (name) =>
    fetch(`https://europe-west2-${PROJECT}.cloudfunctions.net/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `https://${SITE}.web.app` },
      body: JSON.stringify({ data: {} }),
    });
  const who = await callable("whoAmI");
  const whoBody = await who.json().catch(() => ({}));
  (who.ok && whoBody?.result?.authorised === false ? ok : bad)("an anonymous visitor is told to sign in", `${who.status}`);
  (who.headers.get("access-control-allow-origin") === `https://${SITE}.web.app` ? ok : bad)("the backend accepts the dashboard's origin");
  const data = await callable("querySessions");
  const dataBody = await data.json().catch(() => ({}));
  (data.status === 401 && dataBody?.error?.status === "UNAUTHENTICATED" ? ok : bad)("session data refused without sign-in", `${data.status} ${dataBody?.error?.status ?? ""}`);

  const failed = findings.filter((f) => !f.ok);
  if (failed.length) process.exitCode = 1;
}

try {
  if (mode === "preflight") await preflight();
  if (mode === "prepare") await prepare();
  if (mode === "finish") await finish();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
}
