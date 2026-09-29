import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

/**
 * Firebase, configured at build time. The web config is a set of PUBLIC
 * identifiers (docs/13 §5.3 in the survey repo says the same): what authorises is
 * the signed-in account, its role and the security rules. No service-account key
 * or admin credential is ever part of this bundle.
 */

export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === "true";
export const STUDY: string = (import.meta.env.VITE_STUDY as string | undefined) || (USE_EMULATORS ? "demo" : "ybm");
export const REGION = "europe-west2";
export const DATABASE = "dashboard";

const EMULATOR_CONFIG = { apiKey: "fake-api-key", authDomain: "127.0.0.1", projectId: "demo-myself-dashboard", storageBucket: "demo-myself-dashboard.appspot.com" };

function readConfig(): Record<string, string> | null {
  if (USE_EMULATORS) return EMULATOR_CONFIG;
  try {
    const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    return parsed?.["apiKey"] && parsed["projectId"] ? parsed : null;
  } catch {
    return null;
  }
}

export const config = readConfig();
export const configured = config !== null;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let fns: Functions | null = null;

export function firebase(): { app: FirebaseApp; auth: Auth; db: Firestore; fns: Functions } {
  if (!config) throw new Error("This build has no Firebase project configured.");
  if (!app) {
    app = initializeApp(config);
    // Sign-in lasts for this browser tab only: a researcher who walks away from a
    // shared machine does not leave a signed-in dashboard behind them.
    auth = initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    db = getFirestore(app, DATABASE);
    fns = getFunctions(app, REGION);
    if (USE_EMULATORS) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8181);
      connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    }
  }
  return { app, auth: auth ?? getAuth(app), db: db!, fns: fns! };
}

export function googleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

/** Where the authenticated export download endpoint lives. */
export function downloadUrl(jobId: string): string {
  const project = config?.["projectId"] ?? "";
  const base = USE_EMULATORS
    ? `http://127.0.0.1:5001/${project}/${REGION}/downloadExport`
    : ((import.meta.env.VITE_DOWNLOAD_URL as string | undefined) ?? `https://${REGION}-${project}.cloudfunctions.net/downloadExport`);
  return `${base}?job=${encodeURIComponent(jobId)}`;
}
