import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2/options";

/**
 * Where and against what these functions run.
 *
 * REGION is set here, in the module every function file imports, for the reason
 * the survey learned the hard way (apps/functions/src/apps.ts in MySelf): ES
 * modules evaluate imports before the importing module's body, so options set in
 * index.ts arrive after the functions are defined. europe-west2 matches the
 * Firestore location, which a Firestore trigger requires.
 */
export const REGION = "europe-west2";
setGlobalOptions({ region: REGION, maxInstances: 10 });

if (getApps().length === 0) initializeApp();

/** The study this deployment serves (the survey's MYSELF_STUDY). */
export const STUDY = process.env["MYSELF_STUDY"] ?? "ybm";

/** The dashboard's own named Firestore database (docs/02 §2.1). */
export const DASHBOARD_DATABASE = process.env["DASHBOARD_DATABASE"] ?? "dashboard";

/**
 * Browser origins allowed to call these functions. The Hosting site in
 * production; the Vite dev server and emulator-hosted app locally.
 */
export const ALLOWED_ORIGINS: (string | RegExp)[] = (
  process.env["DASHBOARD_ORIGINS"] ?? "https://myself-research-dashboard.web.app,https://myself-research-dashboard.firebaseapp.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(process.env["FUNCTIONS_EMULATOR"] === "true" ? ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"] : []);

/** The survey's database: raw sittings. Read-only from this codebase. */
export const research = (): Firestore => getFirestore();

let dashDb: Firestore | null = null;
/** The dashboard's database: summaries, reviews, views, exports, audit. */
export const dash = (): Firestore => (dashDb ??= getFirestore(DASHBOARD_DATABASE));

export const auth = () => getAuth();
export const bucket = () => getStorage().bucket();

/** Storage prefix for generated exports. Not readable by any client (catch-all deny). */
export const EXPORT_PREFIX = "dashboard-exports";
