import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { cert, initializeApp as initAdmin, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as adminFirestore, FieldValue, type Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * The dashboard database's rules, exercised from both sides against the real
 * Firestore emulator: the caller who should pass and every caller who should not
 * — anonymous survey devices, strangers with Google accounts, approved accounts
 * with no role, read-only reviewers trying to write, and people trying to grant
 * themselves roles or tidy the audit log.
 *
 * Rules are loaded into the emulator for the `dashboard` database specifically
 * (the emulator's per-database rules endpoint), the same file that deploys.
 */

const PROJECT = "demo-myself-dashboard";
const DATABASE = "dashboard";
const HOST = (process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8181").split(":");
const [host, port] = [HOST[0]!, Number(HOST[1] ?? 8181)];
const S = "studies/demo";

let admin: AdminFirestore;
let adminApp: AdminApp;
const apps: FirebaseApp[] = [];

type Who = Record<string, unknown> | null;

const google = (uid: string, email: string, role?: string, extra: Record<string, unknown> = {}): Who => ({
  sub: uid,
  user_id: uid,
  email,
  email_verified: true,
  firebase: { sign_in_provider: "google.com", identities: {} },
  ...(role ? { role } : {}),
  ...extra,
});

const ADMIN = google("u_admin", "brainpopresearch@gmail.com", "owner");
const RESEARCHER = google("u_res", "researcher@brainpop.example", "researcher");
const REVIEWER = google("u_rev", "Reviewer@BrainPOP.example", "analyst");
const NO_ROLE = google("u_norole", "newcomer@brainpop.example");
const STRANGER = google("u_stranger", "stranger@gmail.com", "owner");
const UNVERIFIED = google("u_unver", "brainpopresearch@gmail.com", "owner", { email_verified: false });
const DEVICE = { sub: "dev1", user_id: "dev1", firebase: { sign_in_provider: "anonymous" } };
const DEVICE_CLAIM = google("dev2", "brainpopresearch@gmail.com", "owner", { device: true });
const PASSWORD = { ...google("u_pw", "brainpopresearch@gmail.com", "owner"), firebase: { sign_in_provider: "password" } };

let n = 0;
function db(who: Who): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: "fake" }, `rules-${n++}`);
  apps.push(app);
  const fs = getFirestore(app, DATABASE);
  connectFirestoreEmulator(fs, host, port, who ? { mockUserToken: who as never } : undefined);
  return fs;
}

async function loadRules() {
  const rules = readFileSync(new URL("../dashboard.rules", import.meta.url), "utf8");
  const res = await fetch(`http://${host}:${port}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}:securityRules`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "dashboard.rules", content: rules }] } }),
  });
  if (!res.ok) throw new Error(`could not load rules: ${res.status} ${await res.text()}`);
}

async function clear() {
  await fetch(`http://${host}:${port}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`, { method: "DELETE" });
}

const allowed = async (p: Promise<unknown>) => {
  await expect(p).resolves.not.toThrow();
};
const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: "permission-denied" });
};

beforeAll(async () => {
  process.env["FIRESTORE_EMULATOR_HOST"] = `${host}:${port}`;
  adminApp = initAdmin({ projectId: PROJECT }, "rules-admin");
  void cert;
  admin = adminFirestore(adminApp, DATABASE);
  await loadRules();
});

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
});

beforeEach(async () => {
  await clear();
  const batch = admin.batch();
  batch.set(admin.doc("config/access"), { emails: ["brainpopresearch@gmail.com"], domains: ["brainpop.example"] });
  batch.set(admin.doc("config/policy"), { abandonAfterHours: 24 });
  batch.set(admin.doc(`${S}/releases/sha256:abc`), { version: "1.0.0" });
  batch.set(admin.doc(`${S}/releaseManifests/sha256:abc`), { manifestJson: "{}" });
  batch.set(admin.doc(`${S}/sessionSummaries/s1`), { sessionId: "s1", studyCode: "NDC0001" });
  batch.set(admin.doc(`${S}/meta/freshness`), { lastSummaryAt: FieldValue.serverTimestamp() });
  batch.set(admin.doc(`${S}/reviews/s1`), { sessionId: "s1", status: "unreviewed", flags: [], rev: 0 });
  batch.set(admin.doc(`${S}/reviews/s1/notes/n1`), { text: "checked", authorUid: "u_res" });
  batch.set(admin.doc(`${S}/exportJobs/j_res`), { requestedBy: "u_res", status: "ready", createdAt: FieldValue.serverTimestamp() });
  batch.set(admin.doc(`${S}/auditLog/a_res`), { actorUid: "u_res", action: "session.viewed", at: FieldValue.serverTimestamp() });
  batch.set(admin.doc(`${S}/auditLog/a_admin`), { actorUid: "u_admin", action: "role.changed", at: FieldValue.serverTimestamp() });
  batch.set(admin.doc(`${S}/savedViews/v_private`), { name: "Mine", ownerUid: "u_res", shared: false, state: {}, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  batch.set(admin.doc(`${S}/savedViews/v_shared`), { name: "Team", ownerUid: "u_res", shared: true, state: {}, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  batch.set(admin.doc("users/u_res"), { email: "researcher@brainpop.example", role: "researcher" });
  await batch.commit();
});

describe("people who are not dashboard members get nothing", () => {
  const outsiders: [string, Who][] = [
    ["signed out", null],
    ["an anonymous survey device", DEVICE],
    ["a Google account carrying a device claim", DEVICE_CLAIM],
    ["a Google account not on the allowlist, even with a role", STRANGER],
    ["an allowlisted account with no role", NO_ROLE],
    ["an account with an unverified email", UNVERIFIED],
    ["an email/password account", PASSWORD],
  ];
  for (const [label, who] of outsiders) {
    it(label, async () => {
      const fs = db(who);
      await denied(getDoc(doc(fs, `${S}/releases/sha256:abc`)));
      await denied(getDoc(doc(fs, `${S}/reviews/s1`)));
      await denied(getDoc(doc(fs, `${S}/meta/freshness`)));
      await denied(getDoc(doc(fs, `${S}/savedViews/v_shared`)));
      await denied(getDocs(collection(fs, `${S}/reviews`)));
      await denied(getDoc(doc(fs, "config/access")));
    });
  }

  it("an access policy that does not exist admits nobody", async () => {
    await admin.doc("config/access").delete();
    await denied(getDoc(doc(db(ADMIN), `${S}/releases/sha256:abc`)));
  });
});

describe("members read what their role permits", () => {
  it("every role reads versions, reviews, notes and freshness", async () => {
    for (const who of [ADMIN, RESEARCHER, REVIEWER]) {
      const fs = db(who);
      await allowed(getDoc(doc(fs, `${S}/releases/sha256:abc`)));
      await allowed(getDoc(doc(fs, `${S}/reviews/s1`)));
      await allowed(getDoc(doc(fs, `${S}/reviews/s1/notes/n1`)));
      await allowed(getDoc(doc(fs, `${S}/meta/freshness`)));
    }
  });

  it("a Workspace-domain member is matched case-insensitively", async () => {
    await allowed(getDoc(doc(db(REVIEWER), `${S}/reviews/s1`)));
  });

  it("nobody reads summaries or manifests directly — not even an administrator", async () => {
    // They are served through callables that apply role-based masking.
    for (const who of [ADMIN, RESEARCHER, REVIEWER]) {
      const fs = db(who);
      await denied(getDoc(doc(fs, `${S}/sessionSummaries/s1`)));
      await denied(getDocs(collection(fs, `${S}/sessionSummaries`)));
      await denied(getDoc(doc(fs, `${S}/releaseManifests/sha256:abc`)));
    }
  });

  it("only administrators read configuration", async () => {
    await allowed(getDoc(doc(db(ADMIN), "config/access")));
    await denied(getDoc(doc(db(RESEARCHER), "config/access")));
    await denied(getDoc(doc(db(REVIEWER), "config/policy")));
  });
});

describe("research state cannot be changed from a browser", () => {
  it("a read-only reviewer cannot modify a review, add a flag or write a note", async () => {
    const fs = db(REVIEWER);
    await denied(updateDoc(doc(fs, `${S}/reviews/s1`), { status: "reviewed" }));
    await denied(setDoc(doc(fs, `${S}/reviews/s2`), { status: "needs_review", flags: [] }));
    await denied(addDoc(collection(fs, `${S}/reviews/s1/notes`), { text: "sneaky" }));
  });

  it("nor can a researcher or administrator bypass the audited backend", async () => {
    for (const who of [RESEARCHER, ADMIN]) {
      const fs = db(who);
      await denied(updateDoc(doc(fs, `${S}/reviews/s1`), { status: "reviewed" }));
      await denied(addDoc(collection(fs, `${S}/reviews/s1/notes`), { text: "unaudited" }));
      await denied(deleteDoc(doc(fs, `${S}/reviews/s1/notes/n1`)));
      await denied(setDoc(doc(fs, `${S}/sessionSummaries/s1`), { requiredCompletion: 1 }));
    }
  });

  it("nobody creates an export job directly (exports are authorised on the server)", async () => {
    for (const who of [ADMIN, RESEARCHER, REVIEWER]) {
      await denied(addDoc(collection(db(who), `${S}/exportJobs`), { requestedBy: "u_res", status: "ready", storagePath: "x" }));
    }
    await denied(updateDoc(doc(db(RESEARCHER), `${S}/exportJobs/j_res`), { status: "ready", expiresAt: null }));
  });

  it("nobody grants themselves a role or edits the access list", async () => {
    await denied(setDoc(doc(db(NO_ROLE), "users/u_norole"), { role: "owner" }));
    await denied(setDoc(doc(db(RESEARCHER), "users/u_res"), { role: "owner" }));
    await denied(setDoc(doc(db(STRANGER), "config/access"), { emails: ["stranger@gmail.com"] }));
    await denied(updateDoc(doc(db(ADMIN), "config/access"), { emails: [] }));
    await denied(setDoc(doc(db(ADMIN), "config/policy"), { abandonAfterHours: 1 }));
  });

  it("nobody edits published version history", async () => {
    await denied(setDoc(doc(db(ADMIN), `${S}/releases/sha256:abc`), { version: "9.9.9" }));
    await denied(setDoc(doc(db(ADMIN), `${S}/releaseManifests/sha256:abc`), { manifestJson: "{}" }));
  });
});

describe("export jobs", () => {
  it("the requester and administrators can watch a job; nobody else learns it exists", async () => {
    await allowed(getDoc(doc(db(RESEARCHER), `${S}/exportJobs/j_res`)));
    await allowed(getDoc(doc(db(ADMIN), `${S}/exportJobs/j_res`)));
    await denied(getDoc(doc(db(REVIEWER), `${S}/exportJobs/j_res`)));
    await allowed(getDocs(query(collection(db(RESEARCHER), `${S}/exportJobs`), where("requestedBy", "==", "u_res"), orderBy("createdAt", "desc"), limit(10))));
    await denied(getDocs(collection(db(RESEARCHER), `${S}/exportJobs`)));
  });
});

describe("audit log", () => {
  it("administrators read everything; others only their own activity", async () => {
    await allowed(getDocs(collection(db(ADMIN), `${S}/auditLog`)));
    await allowed(getDoc(doc(db(RESEARCHER), `${S}/auditLog/a_res`)));
    await denied(getDoc(doc(db(RESEARCHER), `${S}/auditLog/a_admin`)));
    await denied(getDocs(collection(db(RESEARCHER), `${S}/auditLog`)));
    await allowed(getDocs(query(collection(db(RESEARCHER), `${S}/auditLog`), where("actorUid", "==", "u_res"))));
  });

  it("nobody writes, edits or deletes an entry — including an administrator, and its subject", async () => {
    await denied(addDoc(collection(db(ADMIN), `${S}/auditLog`), { action: "fabricated", actorUid: "u_admin" }));
    await denied(updateDoc(doc(db(ADMIN), `${S}/auditLog/a_admin`), { action: "nothing" }));
    await denied(deleteDoc(doc(db(ADMIN), `${S}/auditLog/a_admin`)));
    await denied(deleteDoc(doc(db(RESEARCHER), `${S}/auditLog/a_res`)));
  });
});

describe("saved views", () => {
  const view = (ownerUid: string, shared: boolean, extra: Record<string, unknown> = {}) => ({
    name: "Incomplete, last 30 days",
    ownerUid,
    shared,
    state: { path: "/sessions", filters: { statuses: ["incomplete"], datePreset: "30d" }, sort: { key: "startedAt", dir: "desc" } },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  });

  it("anyone with a role keeps private views; only researchers and administrators share", async () => {
    await allowed(setDoc(doc(db(REVIEWER), `${S}/savedViews/v_rev`), view("u_rev", false)));
    await denied(setDoc(doc(db(REVIEWER), `${S}/savedViews/v_rev2`), view("u_rev", true)));
    await allowed(setDoc(doc(db(RESEARCHER), `${S}/savedViews/v_res2`), view("u_res", true)));
  });

  it("a view cannot be created in someone else's name or with a forged timestamp", async () => {
    await denied(setDoc(doc(db(REVIEWER), `${S}/savedViews/v_x`), view("u_res", false)));
    await denied(setDoc(doc(db(RESEARCHER), `${S}/savedViews/v_y`), view("u_res", false, { createdAt: new Date("2020-01-01") })));
  });

  it("search text and unexpected fields are refused", async () => {
    await denied(setDoc(doc(db(RESEARCHER), `${S}/savedViews/v_s`), view("u_res", false, { state: { filters: { search: "NDC0042" } } })));
    await denied(setDoc(doc(db(RESEARCHER), `${S}/savedViews/v_t`), view("u_res", false, { studyCodes: ["NDC0042"] })));
    await denied(setDoc(doc(db(RESEARCHER), `${S}/savedViews/v_u`), view("u_res", false, { name: "" })));
  });

  it("private views are private; shared views are visible to every member", async () => {
    await denied(getDoc(doc(db(REVIEWER), `${S}/savedViews/v_private`)));
    await allowed(getDoc(doc(db(REVIEWER), `${S}/savedViews/v_shared`)));
    await allowed(getDocs(query(collection(db(REVIEWER), `${S}/savedViews`), where("shared", "==", true))));
    await denied(getDocs(collection(db(REVIEWER), `${S}/savedViews`)));
  });

  it("only the owner edits a view; the owner or an administrator deletes it", async () => {
    await denied(updateDoc(doc(db(REVIEWER), `${S}/savedViews/v_shared`), { name: "Mine now", updatedAt: serverTimestamp() }));
    await allowed(updateDoc(doc(db(RESEARCHER), `${S}/savedViews/v_shared`), { name: "Renamed", updatedAt: serverTimestamp() }));
    await denied(updateDoc(doc(db(RESEARCHER), `${S}/savedViews/v_shared`), { ownerUid: "u_rev", updatedAt: serverTimestamp() }));
    await denied(deleteDoc(doc(db(REVIEWER), `${S}/savedViews/v_shared`)));
    await allowed(deleteDoc(doc(db(ADMIN), `${S}/savedViews/v_shared`)));
    await allowed(deleteDoc(doc(db(RESEARCHER), `${S}/savedViews/v_private`)));
  });

  it("a researcher demoted to reviewer can no longer keep a view shared", async () => {
    const demoted = google("u_res", "researcher@brainpop.example", "analyst");
    await denied(updateDoc(doc(db(demoted), `${S}/savedViews/v_shared`), { name: "Still sharing", updatedAt: serverTimestamp() }));
    await allowed(updateDoc(doc(db(demoted), `${S}/savedViews/v_shared`), { shared: false, updatedAt: serverTimestamp() }));
  });
});

describe("users", () => {
  it("read their own mirror; administrators read everyone's", async () => {
    await allowed(getDoc(doc(db(RESEARCHER), "users/u_res")));
    await denied(getDoc(doc(db(REVIEWER), "users/u_res")));
    await allowed(getDoc(doc(db(ADMIN), "users/u_res")));
  });
});

describe("everything else", () => {
  it("is closed", async () => {
    await denied(getDoc(doc(db(ADMIN), "somethingElse/x")));
    await denied(setDoc(doc(db(ADMIN), `${S}/notAThing/x`), { a: 1 }));
    await denied(getDoc(doc(db(ADMIN), "studies/demo")));
  });
});
