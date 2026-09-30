#!/usr/bin/env node
/**
 * Record the dashboard, running for real against the seeded emulators, for the
 * offline demo build (scripts/demo/README.md).
 *
 *   1. Walk every page in a browser as the demo owner, recording each call to a
 *      dashboard function (name, data sent, answer returned).
 *   2. Sweep the calls a visitor could make that the walk did not: every
 *      session's detail, every question's analytics and history.
 *   3. Copy the few collections the web app reads from Firestore directly.
 *
 * Writes apps/web/demo/recording.json. Needs the emulators (firebase.demo.json)
 * seeded by ./seed.mjs, and the emulator build of the web app served at BASE.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const BASE = process.env.DEMO_WEB ?? "http://127.0.0.1:4273";
const PROJECT = process.env.GCLOUD_PROJECT ?? "demo-myself-dashboard";
const STUDY = process.env.MYSELF_STUDY ?? "ybm";
const FUNCTIONS = process.env.DEMO_FUNCTIONS ?? "127.0.0.1:5111";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const OWNER = "demo.researcher@brainpop.example";
const SHOTS = process.env.DEMO_SHOTS; // a folder for screenshots of the walk, when set
const OUT = new URL("../../apps/web/demo/recording.json", import.meta.url); // packed by ./pack.mjs

const calls = [];
const record = (name, data, status, body) => calls.push({ name, data: data ?? null, status, body });

// ── 1. The walk ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("requestfinished", async (req) => {
  const m = /\/europe-west2\/([A-Za-z]+)$/.exec(new URL(req.url()).pathname);
  if (!m || req.method() !== "POST") return;
  const res = await req.response();
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON: the download endpoint */
  }
  record(m[1], JSON.parse(req.postData() ?? "{}").data, res.status(), body);
});
page.on("pageerror", (e) => console.error("page error:", e.message));

let shot = 0;
// Settled once no call to a function has been in flight for a moment. (Not
// "networkidle": Firestore's listeners keep a connection open for good.)
let inflight = 0;
page.on("request", (r) => {
  if (/\/europe-west2\//.test(r.url())) inflight += 1;
});
for (const ev of ["requestfinished", "requestfailed"]) page.on(ev, (r) => {
  if (/\/europe-west2\//.test(r.url())) inflight -= 1;
});
async function settle(label) {
  for (let quiet = 0, waited = 0; quiet < 4 && waited < 150; waited += 1) {
    await page.waitForTimeout(250);
    quiet = inflight === 0 ? quiet + 1 : 0;
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, "0")}-${label}.png`, fullPage: true });
  }
}

await page.goto(BASE + "/");
await page.getByLabel("Emulated Google account").fill(OWNER);
await page.getByRole("button", { name: "Sign in (emulator)" }).click();
await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 60_000 });
await settle("overview");

const routes = [
  "/sessions", "/sessions?st=incomplete", "/sessions?st=complete", "/sessions?st=abandoned", "/sessions?st=in_progress",
  "/completeness", "/questions", "/codebook", "/figures", "/scores", "/participants", "/reports", "/views", "/audit",
  "/settings", "/settings/scoring", "/help",
];
for (const r of routes) {
  await page.goto(BASE + r);
  await settle(r.replace(/[/?=&]+/g, "_"));
}

// Open the first session from the list, so its page is recorded as the app asks for it.
await page.goto(BASE + "/sessions");
await settle("sessions-again");
await page.locator("tbody tr[data-row]").first().click();
await settle("session");
// What an export would contain (the demo never makes one).
await page.goto(BASE + "/sessions");
await settle("sessions-for-export");
const exportButton = page.getByRole("button", { name: /^Export/ }).first();
if (await exportButton.count()) {
  await exportButton.click();
  await settle("export-dialog");
  await page.keyboard.press("Escape");
}

// ── 2. The sweep ────────────────────────────────────────────────────────────
// Sign in to the Auth emulator directly for a token, and call the functions as the web app does.
const idp = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestUri: "http://localhost", returnSecureToken: true, postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `google-${OWNER}`, email: OWNER, email_verified: true }))}&providerId=google.com` }),
}).then((r) => r.json());
async function call(name, data) {
  const res = await fetch(`http://${FUNCTIONS}/${PROJECT}/europe-west2/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idp.idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => null);
  record(name, data, res.status, body);
  return body?.result;
}
const seen = (name) => calls.filter((c) => c.name === name && c.status === 200);

// Every session's detail, in the shape the web app asked for one.
const detail = seen("getSessionDetail")[0]?.data ?? {};
const list = seen("querySessions")[0]?.data ?? { filters: {}, sort: {}, search: "", page: 1, pageSize: 50 };
const sessionIds = new Set();
for (let p = 1, pages = 1; p <= pages; p += 1) {
  // Every sitting, test sittings included.
  const r = await call("querySessions", { ...list, filters: { ...list.filters, dataset: "all" }, page: p, pageSize: 200 });
  pages = r?.pageCount ?? 1;
  for (const row of r?.items ?? []) sessionIds.add(row.sessionId);
}
for (const id of sessionIds) await call("getSessionDetail", { ...detail, sessionId: id });

// Scores, every way the page can group and count them, and each school in focus.
const scores = seen("getScores")[0]?.data ?? {};
for (const observation of ["latest", "first", "all", "wave_1", "wave_2", "wave_3"])
  for (const groupBy of ["school", "yearGroup", "schoolYear", "gender", "wave", "none"]) await call("getScores", { ...scores, observation, groupBy });
for (const school of ["NTH", "STH", "WST"]) await call("getScores", { ...scores, focus: { school } });
for (const yearGroup of [7, 8, 9, 10, 11, 12, 13]) await call("getScores", { ...scores, focus: { yearGroup } });
// The survey researcher view's figures for each dataset choice. They are computed from
// the raw sittings, which the demo does not carry, so only recorded filters play back.
const researcher = seen("getResearcherView")[0]?.data ?? { filters: {} };
for (const dataset of ["all", "test"]) await call("getResearcherView", { ...researcher, filters: { ...researcher.filters, dataset } });
console.log(`walked ${routes.length + 2} pages; swept ${sessionIds.size} sessions; ${calls.length} calls in all`);

// ── 3. What the web app reads from Firestore directly ───────────────────────
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8291";
const dash = getFirestore(initializeApp({ projectId: PROJECT }), "dashboard");
const plain = (v) => {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};
const firestore = {};
// The first four the web app reads itself; the rest feed the lists and charts the demo computes in the browser.
for (const col of ["releases", "exportJobs", "auditLog", "savedViews", "sessionSummaries", "reviews", "releaseManifests"]) {
  const snap = await dash.collection(`studies/${STUDY}/${col}`).get();
  for (const d of snap.docs) firestore[d.ref.path] = plain(d.data());
}
for (const path of [`studies/${STUDY}/meta/freshness`, "config/policy", "config/groups"]) {
  const d = await dash.doc(path).get();
  if (d.exists) firestore[path] = plain(d.data());
}

const me = seen("whoAmI").at(-1)?.body?.result;
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ recordedAt: new Date().toISOString(), study: STUDY, uid: me?.uid ?? null, email: OWNER, calls, firestore }));
console.log(`wrote ${OUT.pathname}: ${calls.length} calls, ${Object.keys(firestore).length} documents`);
await browser.close();
process.exit(0);
