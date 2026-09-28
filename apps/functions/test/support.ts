import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { generateDemoSittings, demoManifest, DEMO_VERSIONS, type DemoSitting } from "@myself-dashboard/core/node";

/**
 * Integration-test support: a synthetic study in the emulators, and real
 * Google-provider identities minted by the Auth emulator.
 */

export const PROJECT = "demo-myself-dashboard";
const AUTH_HOST = process.env["FIREBASE_AUTH_EMULATOR_HOST"] ?? "127.0.0.1:9099";
const FS_HOST = process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8181";

export interface Person {
  uid: string;
  email: string;
  idToken: string;
  decoded: Record<string, unknown>;
}

/**
 * Sign in to the Auth emulator "with Google". The emulator accepts an unsigned
 * JSON id_token, so this produces a genuine ID token whose provider is
 * google.com — the same thing a browser would hold.
 */
export async function googleSignIn(email: string, sub = `google-${email}`): Promise<{ uid: string; idToken: string }> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestUri: "http://localhost",
      returnSecureToken: true,
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub, email, email_verified: true, name: email.split("@")[0] }))}&providerId=google.com`,
    }),
  });
  const body = (await res.json()) as { localId?: string; idToken?: string; error?: unknown };
  if (!body.idToken || !body.localId) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken };
}

/** A person with (optionally) a role, holding a fresh token. */
export async function person(email: string, role: string | null): Promise<Person> {
  const first = await googleSignIn(email);
  await getAuth().setCustomUserClaims(first.uid, role ? { role } : {});
  const { idToken } = await googleSignIn(email);
  const decoded = (await getAuth().verifyIdToken(idToken)) as unknown as Record<string, unknown>;
  return { uid: first.uid, email, idToken, decoded };
}

export async function anonymousDevice(): Promise<Person> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = (await res.json()) as { localId: string; idToken: string };
  const decoded = (await getAuth().verifyIdToken(body.idToken)) as unknown as Record<string, unknown>;
  return { uid: body.localId, email: "", idToken: body.idToken, decoded };
}

export function req<T = unknown>(who: Person | null, data: T): CallableRequest<T> {
  return {
    data,
    auth: who ? { uid: who.uid, token: who.decoded as never, rawToken: who.idToken } : undefined,
    rawRequest: {} as never,
    acceptsStreaming: false,
  } as unknown as CallableRequest<T>;
}

export async function resetEmulators(): Promise<void> {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  for (const db of ["(default)", "dashboard"]) {
    await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/${db}/documents`, { method: "DELETE" });
  }
}

/** Write synthetic sittings into the survey database exactly as saveSitting would. */
export async function seedSittings(now = new Date()): Promise<DemoSitting[]> {
  const sittings = generateDemoSittings({ now, count: 48 });
  const db = getFirestore();
  for (let i = 0; i < sittings.length; i += 200) {
    const batch = db.batch();
    for (const s of sittings.slice(i, i + 200)) batch.set(db.doc(`studies/demo/sessions/${s.doc.sessionId}`), s.doc);
    await batch.commit();
  }
  return sittings;
}

export const demoManifests = () => DEMO_VERSIONS.map((v) => demoManifest(v));
